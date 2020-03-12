const Gio      = imports.gi.Gio
const GLib     = imports.gi.GLib;
const Shell    = imports.gi.Shell;
const Main     = imports.ui.main;
const Util     = imports.misc.util;
const ByteArray = imports.byteArray;
const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const IFACE = `${ME.path}/dbus/time_tracker_iface.xml`;


const MISC_UTILS = ME.imports.lib.misc_utils;
const REG        = ME.imports.lib.regex;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ TimeTracker
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
var TimeTracker = class TimeTracker {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + ByteArray.toString(xml);
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
            this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/TimeTracker');
        }


        this.number_of_tracked_tasks = 0;
        this.tic_mainloop_id         = 0;


        // Holds the path of the current csv directory.
        // We also use this as a flag to check whether the tracker is active.
        this.csv_dir = this.get_csv_dir_path();


        this.yearly_csv_dir  = null;
        this.yearly_csv_file = null;
        this.daily_csv_file  = null;


        this.yearly_csv_dir_monitor  = null;
        this.yearly_csv_file_monitor = null;
        this.daily_csv_file_monitor  = null;
        this.yearly_csv_dir_monitor_id  = null;
        this.yearly_csv_file_monitor_id = null;
        this.daily_csv_file_monitor_id  = null;


        // @stats_data: Map
        //   - @key: string (date in 'yyyy-mm-dd' iso format)
        //   - @val: array of objects of form:
        //      {
        //          label      : string (a project or task)
        //          type       : string ('++' or '()')
        //          total_time : int (seconds spent working on this task/proj)
        //          intervals  : string
        //      }
        //
        // The keys in @stats_data are sorted from newest to oldest.
        // In each @val inside @stats_data, the projects are sorted after tasks.
        this.stats_data = new Map();


        // @stats_unique_task     : Set (of all unique tasks strings)
        // @stats_unique_projcets : Set (of all unique projects strings)
        this.stats_unique_tasks    = new Set();
        this.stats_unique_projects = new Set();

        // string (in yyyy-mm-dd iso format)
        // This is the oldest date in the stats data entry
        this.oldest_date = '';


        // @key: string
        //   - task string (a single line in the todo.txt file)
        //   - or project keyword (e.g., '+my_project', '+stuff', etc...)
        //
        // @val: obj
        //   of the form: {
        //       time       : int (miscroseconds)
        //       start_time : int (microseconds for elapsed time computing)
        //       tracking   : bool
        //       type       : string ('++' = project, '()' = task)
        //       intervals  : string
        //   }
        //
        //   If @type is '()', then @val also has the prop:
        //       task_ref: obj (the ref of the corresponding task object)
        //
        //   If @type is '++', then @val also has the prop:
        //       @tracked_children: int (number of tasks that are part of this
        //                               project and that are being tracked)
        this.daily_csv_map = new Map();


        //
        // listen
        //
        this.new_day_sig_id = this.delegate.connect('new-day', () => this._on_new_day_started());
        this.ext.connect('start-time-tracking-by-id', (_1, _2, task_id) => {
            this.start_tracking_by_id(task_id);
        });
        this.ext.connect('stop-time-tracking-by-id', (_1, _2, task_id) => {
            this.stop_tracking_by_id(task_id);
        });


        //
        // finally
        //
        this._init_finish();
    }

    _init_finish () {
        this._init_tracker_dir();
        this._init_daily_csv_map();
        this._archive_yearly_csv_file();
    }

    _init_tracker_dir () {
        this._disable_file_monitors();

        if (! this.csv_dir) return;

        let d = new Date();

        try {
            // yearly dir
            this.yearly_csv_dir = MISC_UTILS.file_new_for_path(
                `${this.csv_dir}/YEARS__time_tracker`);
            if (! this.yearly_csv_dir.query_exists(null))
                this.yearly_csv_dir.make_directory_with_parents(null);


            // yearly file
            this.yearly_csv_file = MISC_UTILS.file_new_for_path(
                `${this.csv_dir}/${d.getFullYear()}__time_tracker.csv`);
            if (! this.yearly_csv_file.query_exists(null))
                this.yearly_csv_file.create(Gio.FileCreateFlags.NONE, null);


            // daily file
            this.daily_csv_file = MISC_UTILS.file_new_for_path(`${this.csv_dir}/TODAY__time_tracker.csv`);
            if (! this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);


            this._enable_file_monitors();
        } catch (e) {
            logError(e);
            this.csv_dir = "";
        }
    }

    _init_daily_csv_map () {
        if (! this.csv_dir) return;

        this.daily_csv_map.clear();

        let today = MISC_UTILS.date_yyyymmdd();

        let [, lines] = this.daily_csv_file.load_contents(null);
        lines = ByteArray.toString(lines).split(/\r?\n/).filter((l) => /\S/.test(l));

        let do_write_daily_csv_file = false;
        let tasks_to_be_tracked = [];

        for (let i = 0; i < lines.length; i++) {
            let [e, date, time, type, val, intervals] = this._parse_csv_line(lines[i]);

            if (e) {
                let file_path = this.daily_csv_file.get_path();
                let msg       = 'line: %d\nfile: %s'.format(i, file_path);

                Main.notify(_('Error while parsing csv file. See logs.'), msg);
                log("ERROR timepp (csv file):\nline: %d\nfile: %s".format(i, file_path));

                continue;
            }

            if (date !== today) {
                this._archive_daily_csv_file(date.slice(0, 4));
                this.daily_csv_map.clear();
                return;
            }

            if (intervals.endsWith('..')) {
                intervals = intervals.slice(0, -2);
                if (type === '()') tasks_to_be_tracked.push(val);
                do_write_daily_csv_file = true;
            }

            let entry = {
                tracking  : false,
                type      : type,
                time      : time * 1000000,
                intervals : intervals,
            };

            let t = GLib.get_monotonic_time();

            if (type === '++') entry.tracked_children = 0;
            else               entry.task_ref = null;

            this.daily_csv_map.set(val, entry);
        }

        if (do_write_daily_csv_file) this._write_daily_csv_file();

        if (this.delegate.settings.get_boolean('todo-resume-tracking')) {
            for (let task_str of tasks_to_be_tracked) {
                for (let task of this.delegate.tasks) {
                    if (task.task_str === task_str) {
                        this.start_tracking(task);
                        break;
                    }
                }
            }
        }
    }

    _write_daily_csv_file () {
        if (! this.csv_dir) return;

        let today    = MISC_UTILS.date_yyyymmdd();
        let projects = '';
        let tasks    = '';

        for (let [k, v] of this.daily_csv_map) {
            let line = this._create_csv_line(today, v.time, v.type, k, v.intervals);
            if (v.type === '++') projects += line;
            else                 tasks    += line;
        }

        this._disable_file_monitors();
        try {
            this.daily_csv_file.replace_contents(projects + tasks, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) { logError(e); }
        this._enable_file_monitors();
    }

    // @year: string
    _archive_daily_csv_file (year = null) {
        if (! this.csv_dir) return;

        this._disable_file_monitors();

        try {
            let [, contents]  = this.daily_csv_file.load_contents(null);
            let append_stream;

            if (year) {
                append_stream = MISC_UTILS.file_new_for_path(`${this.csv_dir}/${year}__time_tracker.csv`);
                append_stream = append_stream.append_to(Gio.FileCreateFlags.NONE, null);
            } else {
                append_stream = this.yearly_csv_file.append_to(Gio.FileCreateFlags.NONE, null);
            }

            append_stream.write_all(contents, null);
            this.daily_csv_file.replace_contents('', null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) { logError(e); }

        this._enable_file_monitors();

        let d        = new Date();
        let time_str = "%02d:%02d:%02d".format(d.getHours(), d.getMinutes(), d.getSeconds());
        let d_str    = MISC_UTILS.date_yyyymmdd(d);

        for (let [,v] of this.daily_csv_map) {
            v.time = 0;
            v.date = d_str;
            if (v.tracking) v.intervals = `${time_str}..${time_str}..`;
            else            v.intervals = '';
        }
    }

    // Returns bool (true = we archived the yearly file)
    _archive_yearly_csv_file () {
        if (! this.csv_dir) return;

        let d = new Date();
        let prev_f = `${this.csv_dir}/${d.getFullYear() - 1}__time_tracker.csv`;

        if (GLib.file_test(prev_f, GLib.FileTest.EXISTS)) {
            this._disable_file_monitors();
            let dir = `${this.csv_dir}/YEARS__time_tracker`;
            Util.spawnCommandLine(`mv ${prev_f} ${dir}`);
            this._enable_file_monitors();
            return true;
        }

        return false;
    }

    _enable_file_monitors (timeout = 100) {
        if (!this.daily_csv_file_monitor) {
            this.daily_csv_file_monitor = this.daily_csv_file.monitor(Gio.FileMonitorFlags.NONE, null);
        }

        if (!this.yearly_csv_file_monitor) {
            this.yearly_csv_file_monitor = this.yearly_csv_file.monitor(Gio.FileMonitorFlags.NONE, null);
        }

        if (!this.yearly_csv_dir_monitor) {
            this.yearly_csv_dir_monitor = this.yearly_csv_dir.monitor(Gio.FileMonitorFlags.NONE, null);
        }

        Mainloop.timeout_add(timeout, () => {
            this.daily_csv_file_monitor_id = this.daily_csv_file_monitor.connect('changed', (...args) => {
                this._on_tracker_files_modified();
            });
            this.yearly_csv_file_monitor_id = this.yearly_csv_file_monitor.connect('changed', (...args) => {
                this._on_tracker_files_modified();
            });
            this.yearly_csv_dir_monitor_id = this.yearly_csv_dir_monitor.connect('changed', (...args) => {
                this._on_tracker_files_modified();
            });
        });
    }

    _disable_file_monitors () {
        if (this.daily_csv_file_monitor)
            this.daily_csv_file_monitor.disconnect(this.daily_csv_file_monitor_id);

        if (this.yearly_csv_file_monitor)
            this.yearly_csv_file_monitor.disconnect(this.yearly_csv_file_monitor_id);


        if (this.yearly_csv_dir_monitor)
            this.yearly_csv_dir_monitor.disconnect(this.yearly_csv_dir_monitor);
    }

    _tracker_tic (...args) {
        let d        = new Date();
        let time     = GLib.get_monotonic_time();
        let time_str = "%02d:%02d:%02d".format(d.getHours(), d.getMinutes(), d.getSeconds());

        for (let [,v] of this.daily_csv_map) {
            if (v.tracking) {
                v.time      = time - v.start_time;
                v.intervals = v.intervals.slice(0, -10) + time_str + '..';
            }
        }

        let seconds = args[0] || 30;

        if (seconds === 30) {
            seconds = 0;
            this._write_daily_csv_file();
        }

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tracker_tic(seconds + 1);
        });
    }

    _on_new_day_started () {
        if (! this.csv_dir) this._init_finish();

        this._archive_daily_csv_file();

        let yearly_file_was_archived = this._archive_yearly_csv_file();

        // To ensure a fresh yearly csv file.
        if (yearly_file_was_archived) this._init_tracker_dir();
    }

    _on_tracker_files_modified () {
        this.stop_all_tracking(false);

        this.daily_csv_map.clear();
        this.stats_data.clear();
        this.stats_unique_tasks.clear();
        this.stats_unique_projects.clear();

        this._init_finish();
    }

    _parse_csv_line (line) {
        let res           = [false];
        let field         = '';
        let inside_quotes = false;

        for (let i = 0, len = line.length; i < len; i++) {
            let ch = line[i];

            if (ch === '"') {
                if (i+1 === len || line[i+1] === ',') { // quote at end of field
                    inside_quotes = false;
                    res.push(field);
                    field = '';
                    i += 2; // eat the next comma and space after it
                }
                else if (!field) { // quote at start of field
                    inside_quotes = true;
                }
                else {
                    field += '"';
                }
            } else if (ch === ',' && !inside_quotes) {
                res.push(field);
                field = '';
                i++; // eat space after comma
            } else {
                field += ch;
            }
        }

        res.push(field);

        if (!REG.ISO_DATE.test(res[1]) ||
            !/\d{2}:\d{2}(:\d{2})?$/.test(res[2]) ||
            (res[3] !== '++' && res[3] !== '()')) {

            return [true];
        }

        // No intervals field found (backwards compatibility.)
        if (res.length !== 6) res.push('');

        let t  = res[2].split(':');
        res[2] = +(t[0])*3600 + +(t[1])*60 + (t.length === 3 ? +(t[2]) : 0);

        res[4] = res[4].replace(/""/g, '"');

        return res;
    }

    _create_csv_line (date, time, type, val, intervals) {
        let h, m, s;

        {
            time = Math.round(time / 1000000);

            h = Math.floor(time / 3600);
            h = (h < 10) ? ('0' + h) : ('' + h);

            time %= 3600;

            m = Math.floor(time / 60);
            m = (m < 10) ? ('0' + m) : ('' +  m);

            s = time % 60;
            s = (s < 10) ? ('0' + s) : ('' +  s);
        }

        val = val.replace(/"/g, '""');

        if (intervals) {
            let tokens = intervals.split('||');
            let non_zero_intervals = [];

            // Remove zero-length intervals.
            for (let token of tokens) {
                // We don't remove zero-length intervals that are open (i.e.,
                // the last interval.)
                if (token.endsWith('..')) {
                    non_zero_intervals.push(token);
                    continue;
                }

                let [start, end] = token.split('..');
                if (start !== end) non_zero_intervals.push(token);
            }

            intervals = non_zero_intervals.join('||');

            return `${date}, ${h}:${m}:${s}, ${type}, "${val}", ${intervals}\n`;
        } else {
            return `${date}, ${h}:${m}:${s}, ${type}, "${val}"\n`;
        }
    }

    toggle_tracking (task) {
        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) this.stop_tracking(task);
        else                     this.start_tracking(task);
    }

    stop_all_tracking (do_write_daily_csv_file = true, close_intervals = true) {
        if (! this.csv_dir) return;

        for (let [k, v] of this.daily_csv_map) {
            if (v.type === '()' && v.tracking)
                this.stop_tracking(v.task_ref, false, close_intervals);
        }

        if (do_write_daily_csv_file) this._write_daily_csv_file();
    }

    start_tracking_by_id (id) {
        if (! this.csv_dir) return;

        for (let it of this.delegate.tasks) {
            if (it.tracker_id === id) this.start_tracking(it);
        }
    }

    stop_tracking_by_id (id) {
        if (! this.csv_dir) return;

        for (let it of this.delegate.tasks) {
            if (it.tracker_id === id) this.stop_tracking(it);
        }
    }

    start_tracking (task) {
        if (! this.csv_dir) {
            Main.notify(_('To track time, select a dir for csv files in the settings.'));
            return;
        }

        if (task.completed) return;

        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) return;

        let start_time = GLib.get_monotonic_time();
        let d          = new Date();
        let time_str   = "%02d:%02d:%02d".format(d.getHours(), d.getMinutes(), d.getSeconds());

        if (val) {
            val.tracking   = true;
            val.task_ref   = task;
            val.start_time = start_time - val.time;
            if (val.intervals) val.intervals += `||${time_str}..${time_str}..`;
            else               val.intervals  = `${time_str}..${time_str}..`;
        } else {
            this.daily_csv_map.set(task.task_str, {
                time       : 0,
                start_time : start_time,
                tracking   : true,
                type       : '()',
                task_ref   : task,
                intervals  : `${time_str}..${time_str}..`,
            });
        }

        for (let project of task.projects) {
            let val = this.daily_csv_map.get(project);

            if (val) {
                val.tracked_children++;
                if (!val.tracking) {
                    val.tracking = true;
                    val.start_time = start_time - val.time;
                    if (val.intervals) val.intervals += `||${time_str}..${time_str}..`;
                    else               val.intervals  = `${time_str}..${time_str}..`;
                }
            } else {
                this.daily_csv_map.set(project, {
                    time             : 0,
                    tracking         : true,
                    type             : '++',
                    tracked_children : 1,
                    start_time       : start_time,
                    intervals        : `${time_str}..${time_str}..`,
                });
            }
        }

        this.number_of_tracked_tasks++;

        if (this.tic_mainloop_id === 0) this._tracker_tic();

        this.delegate.panel_item.actor.add_style_class_name('on');

        for (let it of this.delegate.tasks) {
            if (it.task_str === task.task_str) it.on_tracker_started();
        }

        this.dbus_impl.emit_signal('started_tracking', GLib.Variant.new('(s)', [task.task_str]));
    }

    stop_tracking (task, do_write_daily_csv_file = true, close_intervals = true) {
        if (!this.csv_dir) return;

        let val = this.daily_csv_map.get(task.task_str);

        if (!val || !val.tracking) return;

        val.tracking = false;
        this.number_of_tracked_tasks--;

        if (close_intervals) {
            if (val.intervals.endsWith('..'))
                val.intervals = val.intervals.slice(0, -2);
        }

        for (let project of task.projects) {
            let val = this.daily_csv_map.get(project);

            if (--val.tracked_children === 0) {
                val.tracking = false;

                if (close_intervals) {
                    if (val.intervals.endsWith('..'))
                        val.intervals = val.intervals.slice(0, -2);
                }
            }
        }

        for (let it of this.delegate.tasks) {
            if (it.task_str === task.task_str) it.on_tracker_stopped();
        }

        if (this.number_of_tracked_tasks === 0) {
            this.delegate.panel_item.actor.remove_style_class_name('on');

            if (this.tic_mainloop_id > 0) {
                Mainloop.source_remove(this.tic_mainloop_id);
                this.tic_mainloop_id = 0;
            }
        }

        if (do_write_daily_csv_file) this._write_daily_csv_file();

        this.dbus_impl.emit_signal('stopped_tracking', GLib.Variant.new('(s)', [task.task_str]));
    }

    get_tracked_tasks () {
        let res = "";

        for (let [k, v] of this.daily_csv_map) {
            if (v.tracking && v.type === '()') res += k + "___timepp___";
        }

        return res ? res : "none";
    }

    get_tracked_projects () {
        let res = "";

        for (let [k, v] of this.daily_csv_map) {
            if (v.tracking && v.type === '++') res += k + "___timepp___";
        }

        return res ? res : "none";
    }

    // Swap the old_task_str with the new_task_str in the daily_csv_map only.
    // The time tracked on the old_task_str is copied over to the new_task_str.
    update_record_name (old_task_str, new_task_str) {
        if (!this.csv_dir || this.daily_csv_map.get(new_task_str)) return;

        let val = this.daily_csv_map.get(old_task_str);

        if (! val) return;

        this.daily_csv_map.delete(old_task_str);
        this.daily_csv_map.set(new_task_str, val);

        // We would like to delete the old task from the stats entries, but we
        // can't tell whether or not we tracked the old task on days prior to
        // today.
        // We clear the cached stats data to let get_stats() rebuild it.
        this.stats_unique_tasks.clear();
        this.stats_unique_projects.clear();
        this.stats_data.clear();

        this._write_daily_csv_file();
    }

    get_csv_dir_path () {
        let d = this.delegate.get_current_todo_file();
        if (!d) return "";
        return d.time_tracker_dir;
    }

    // NOTE: The returned values are cached, use for READ-ONLY!
    //
    // returns: [@stats_data, @stats_unique_tasks, @stats_unique_projects, oldest_date]
    get_stats () {
        if (! this.csv_dir) return null;

        let today = MISC_UTILS.date_yyyymmdd();
        let oldest_date = this.oldest_date ? this.oldest_date : today;

        let stats_unique_tasks    = this.stats_unique_tasks;
        let stats_unique_projects = this.stats_unique_projects;

        // update todays data
        {
            let stats_today = [];

            for (let [k, v] of this.daily_csv_map) {
                if (v.type === '()') stats_unique_tasks.add(k);
                else                 stats_unique_projects.add(k);

                let record = {
                    label      : k,
                    type       : v.type,
                    total_time : Math.round(v.time / 1000000),
                    intervals  : v.intervals,
                };

                if (v.type === '++') stats_today.push(record);
                else                 stats_today.unshift(record);
            }

            this.stats_data.set(today, stats_today);
        }

        // add the rest if we don't have it cached
        if (this.stats_data.size < 2) {
            let reg       = /^\d{4}__time_tracker.csv$/;
            let csv_files = [];
            let file_enum;

            try {
                file_enum = this.yearly_csv_dir.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
            } catch (e) { file_enum = null; }

            if (file_enum !== null) {
                let info;

                while ((info = file_enum.next_file(null))) {
                    if (! reg.test(info.get_name())) continue;
                    csv_files.push([file_enum.get_child(info), info.get_name()]);
                }
            }

            csv_files.push([this.yearly_csv_file, this.yearly_csv_file.get_basename()]);
            csv_files.sort((a, b) => a[1] < b[1]);

            for (let file of csv_files) {
                let [, content] = file[0].load_contents(null);
                content         = String(content).split(/[\r\n]/).filter((l) => /\S/.test(l));

                let parse      = this._parse_csv_line;
                let stats_data = this.stats_data;
                let found_at_least_one_error = false;

                let i = content.length;

                while (i--) {
                    let [e, date, time, type, label, intervals] = parse(content[i]);

                    if (e) {
                        let file_path = file[0].get_path();
                        log("ERROR timepp (csv file):\nline: %d\nfile: %s".format(i+1, file_path));

                        // If there are multiple errors, we don't want to bring
                        // the system to a halt we a bazillion notifs.
                        if (!found_at_least_one_error) {
                            let msg = 'line: %d\nfile: %s'.format(i+1, file_path);
                            Main.notify(_('Error while parsing csv file. See logs.'), msg);
                            found_at_least_one_error = true;
                        }

                        continue;
                    }

                    if (type === '()') stats_unique_tasks.add(label);
                    else               stats_unique_projects.add(label);

                    let record = {
                        label      : label,
                        type       : type,
                        total_time : time,
                        intervals  : intervals,
                    };

                    let records = stats_data.get(date);

                    if (records) records.push(record);
                    else         stats_data.set(date, [record]);

                    oldest_date = date;
                }
            }
        }

        this.oldest_date = oldest_date;

        return [this.stats_data, this.stats_unique_tasks, this.stats_unique_projects, oldest_date];
    }

    close () {
        this.stop_all_tracking(true, false);

        if (this.daily_csv_file_monitor) {
            this.daily_csv_file_monitor.cancel();
            this.daily_csv_file_monitor = null;
        }

        if (this.yearly_csv_file_monitor) {
            this.yearly_csv_file_monitor.cancel();
            this.yearly_csv_file_monitor = null;
        }

        if (this.yearly_csv_dir_monitor) {
            this.yearly_csv_dir_monitor.cancel();
            this.yearly_csv_dir_monitor = null;
        }

        if (this.new_day_sig_id) this.delegate.disconnect(this.new_day_sig_id);
        if (this.todo_current_sig_id) this.delegate.settings.disconnect(this.todo_current_sig_id);

        this.daily_csv_map.clear();
        this.stats_data.clear();
        this.stats_unique_tasks.clear();
        this.stats_unique_projects.clear();
        this.dbus_impl.unexport();
    }
}
Signals.addSignalMethods(TimeTracker.prototype);
