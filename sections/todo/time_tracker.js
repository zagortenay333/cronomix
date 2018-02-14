const Gio      = imports.gi.Gio
const GLib     = imports.gi.GLib;
const Shell    = imports.gi.Shell;
const Main     = imports.ui.main;
const Util     = imports.misc.util;
const Lang     = imports.lang;
const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const IFACE = `${ME.path}/dbus/time_tracker_iface.xml`;


const G = ME.imports.sections.todo.GLOBAL;



// =====================================================================
// @@@ Time tracker
//
// @ext      : obj    (main extension object)
// @delegate : obj    (main section object)
// =====================================================================
var TimeTracker = new Lang.Class({
    Name: 'Timepp.TimeTracker',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + xml;
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
            this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/TimeTracker');
        }


        this.number_of_tracked_tasks = 0;
        this.tic_mainloop_id         = null;


        // Holds the path of the current csv directory.
        // We also use this as a flag to check whether the tracker is active.
        this.csv_dir = null;


        // GFiles
        this.yearly_csv_dir  = null;
        this.yearly_csv_file = null;
        this.daily_csv_file  = null;


        // GFileMonitors
        this.yearly_csv_dir_monitor  = null;
        this.yearly_csv_file_monitor = null;
        this.daily_csv_file_monitor  = null;

        this.monitors_block = false;


        // The stats data is cached with the exception of today's stats which
        // get appended.
        this.stats_data           = new Map();
        this.stats_unique_entries = new Set();


        // @key: string
        //   which is either a task string (a single line in the
        //   todo.txt file) or a project keyword (e.g., '+my_project', '+stuff',
        //   etc...)
        //
        // @val: obj
        //   of the form: {
        //       time       : int (in seconds)
        //       tracking   : bool
        //       type       : string ('++' = project, '()' = task)
        //       start_time : int (time in microsec for elapsed time computing)
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
        // init
        //
        this.csv_dir = this.get_csv_dir_path();
        this._init_tracker_dir();
        this._init_daily_csv_map();
        this._archive_yearly_csv_file();


        //
        // listen
        //
        this.delegate.connect('new-day', () => {
            this._archive_daily_csv_file();
            this._archive_yearly_csv_file();
            this._init_tracker_dir(); // to ensure the new yearly_csv_file
        });
        this.ext.connect('start-time-tracking-by-id', (_, info) => {
            this.start_tracking_by_id(info.data);
        });
        this.ext.connect('stop-time-tracking-by-id', (_, info) => {
            this.stop_tracking_by_id(info.data);
        });
        delegate.settings.connect('changed::todo-current', () => {
            this.csv_dir = this.get_csv_dir_path();
            this._init_tracker_dir();
        });
    },

    _tracker_tic: function (...args) {
        if (this.number_of_tracked_tasks === 0) {
            this.tic_mainloop_id = null;
            return;
        }

        let time = GLib.get_monotonic_time();
        let min  = args[0] || 1;

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            for (let [,v] of this.daily_csv_map) {
                if (v.tracking) v.time = time - v.start_time;
            }

            if (min === 60) {
                min = 0;
                Mainloop.idle_add(() => this._write_daily_csv_file());
            }

            this._tracker_tic(++min);
        });
    },

    _on_tracker_files_modified: function () {
        // @HACK
        // The normal handler_block/unblock methods don't work with a file
        // monitor for some reason.
        if (this.monitors_block) {
            Mainloop.idle_add(() => this.monitors_block = false);
            return;
        }

        this.stop_all_tracking();
        this.daily_csv_map.clear();
        this.stats_data.clear();
        this.stats_unique_entries.clear();

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this._init_tracker_dir();
        this._init_daily_csv_map();
        this._archive_yearly_csv_file();
    },

    _init_tracker_dir: function () {
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

        if (! this.csv_dir) return;

        let d = new Date();

        try {
            // yearly dir
            this.yearly_csv_dir = Gio.file_new_for_path(
                `${this.csv_dir}/YEARS__time_tracker`);

            if (! this.yearly_csv_dir.query_exists(null))
                this.yearly_csv_dir.make_directory_with_parents(null);

            this.yearly_csv_dir_monitor = this.yearly_csv_dir.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES, null);

            this.yearly_csv_dir_monitor.connect('changed', () => {
                this._on_tracker_files_modified();
            });


            // yearly file
            this.yearly_csv_file = Gio.file_new_for_path(
                `${this.csv_dir}/${d.getFullYear()}__time_tracker.csv`);

            if (! this.yearly_csv_file.query_exists(null))
                this.yearly_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.yearly_csv_file_monitor = this.yearly_csv_file.monitor_file(
                Gio.FileMonitorFlags.WATCH_MOVES, null);

            this.yearly_csv_file_monitor.connect('changed', () => {
                this._on_tracker_files_modified();
            });


            // daily file
            this.daily_csv_file = Gio.file_new_for_path(
                `${this.csv_dir}/TODAY__time_tracker.csv`);

            if (! this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.daily_csv_file_monitor = this.daily_csv_file.monitor_file(
                Gio.FileMonitorFlags.WATCH_MOVES, null);

            this.daily_csv_file_monitor.connect('changed', () => {
                this._on_tracker_files_modified();
            });
        }
        catch (e) {
            logError(e);
        }
    },

    _init_daily_csv_map: function () {
        if (! this.csv_dir) return;

        let date_str = G.date_yyyymmdd();

        let [, lines] = this.daily_csv_file.load_contents(null);
        lines = String(lines).split(/\n|\r/).filter((l) => /\S/.test(l));

        for (let it of lines) {
            if (it.substr(0, 10) !== date_str) {
                this._archive_daily_csv_file();
                this.daily_csv_map.clear();
                break;
            }

            if (it === '') continue;

            let key  = it.substring(24, it.length - 1).replace(/""/g, '"');
            let type = it.substr(19, 2);

            let entry = {
                tracking : false,
                type     : type,
                time     : 1000000 * (+(it.substr(12, 2)) * 3600 +
                                      +(it.substr(15, 2)) * 60),
            };

            if (type === '++') entry.tracked_children = 0;
            else               entry.task_ref = null;

            this.daily_csv_map.set(key, entry);
        }
    },

    _write_daily_csv_file: function () {
        if (! this.csv_dir) return;

        this.monitors_block = true;

        let d        = G.date_yyyymmdd();
        let projects = '';
        let tasks    = '';

        for (let [k, v] of this.daily_csv_map) {
            let t = Math.floor(v.time / 1000000);

            if (t < 60) continue;

            let hh = Math.floor(t / 3600);
            hh     = (hh < 10) ? ('0' + hh) : ('' + hh);

            let mm = Math.round(t % 3600 / 60);
            mm     = (mm < 10) ? ('0' + mm) : ('' +  mm);

            let line =
                `${d}, ${hh}:${mm}, ${v.type}, \"${k.replace(/"/g, '""')}\"\n`;

            if (v.type === '++') projects += line;
            else                 tasks    += line;
        }

        try {
            if (! this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.daily_csv_file.replace_contents(projects + tasks, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }
        catch (e) {
            logError(e);
        }
    },

    _archive_daily_csv_file: function () {
        if (! this.csv_dir) return;

        this.monitors_block = true;

        try {
            let [, contents]  = this.daily_csv_file.load_contents(null);

            let append_stream = this.yearly_csv_file.append_to(
                Gio.FileCreateFlags.NONE, null);

            append_stream.write_all(contents, null);

            this.daily_csv_file.replace_contents('', null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }
        catch (e) {
            logError(e);
        }

        let d = G.date_yyyymmdd();

        for (let [,v] of this.daily_csv_map) {
            v.date = d;
            v.time = 0;
        }
    },

    _archive_yearly_csv_file: function () {
        if (! this.csv_dir) return;

        this.monitors_block = true;

        let d = new Date();

        let prev_f =
            `${this.csv_dir}/${d.getFullYear() - 1}__time_tracker.csv`;

        if (GLib.file_test(prev_f, GLib.FileTest.EXISTS)) {
            let dir = `${this.csv_dir}/YEARS__time_tracker`;
            Util.spawnCommandLine(`mv ${prev_f} ${dir}`);
        }
    },

    toggle_tracking: function (task) {
        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) this.stop_tracking(task);
        else                     this.start_tracking(task);
    },

    stop_all_tracking: function () {
        if (!this.csv_dir) return;

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.number_of_tracked_tasks = 0;

        for (let [k, v] of this.daily_csv_map) {
            if (v.tracking) {
                v.tracking = false;

                if (v.type === '()' && v.task_ref)
                    v.task_ref.on_tracker_stopped();
            }
        }

        this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    start_tracking_by_id: function (id) {
        for (let it of this.delegate.tasks) {
            if (it.tracker_id === id) this.start_tracking(it);
        }
    },

    stop_tracking_by_id: function (id) {
        for (let it of this.delegate.tasks) {
            if (it.tracker_id === id) this.stop_tracking(it);
        }
    },

    start_tracking: function (task) {
        if (!this.csv_dir) {
            Main.notify(
                _('To track time, select a dir for csv files in the settings.'));

            return null;
        }

        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) return;

        let start_time = GLib.get_monotonic_time();

        if (val) {
            val.tracking   = true;
            val.task_ref   = task;
            val.start_time = start_time - val.time;
        }
        else {
            this.daily_csv_map.set(task.task_str, {
                time       : 0,
                tracking   : true,
                type       : '()',
                task_ref   : task,
                start_time : start_time,
            });
        }

        for (let project of task.projects) {
            val = this.daily_csv_map.get(project);

            if (val) {
                val.tracking = true;
                val.tracked_children++;
                val.start_time = start_time - val.time;
            }
            else {
                this.daily_csv_map.set(project, {
                    time             : 0,
                    tracking         : true,
                    type             : '++',
                    tracked_children : 1,
                    start_time       : start_time,
                });
            }
        }

        this.number_of_tracked_tasks++;
        if (! this.tic_mainloop_id) this._tracker_tic();

        for (let it of this.delegate.tasks) {
            if (it.task_str === task.task_str) it.on_tracker_started();
        }

        this.delegate.panel_item.actor.add_style_class_name('on');
    },

    stop_tracking: function (task) {
        if (!this.csv_dir) return null;

        let val = this.daily_csv_map.get(task.task_str);

        if (!val || !val.tracking) return;

        val.tracking = false;
        this.number_of_tracked_tasks--;

        for (let project of task.projects) {
            let val = this.daily_csv_map.get(project);
            if (--val.tracked_children === 0) val.tracking = false;
        }

        for (let it of this.delegate.tasks) {
            if (it.task_str === task.task_str) it.on_tracker_stopped();
        }

        if (this.number_of_tracked_tasks === 0)
            this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    // Swap the old_task_str with the new_task_str in the daily_csv_map only.
    // The time tracked on the old_task_str is copied over to the new_task_str.
    update_record_name: function (old_task_str, new_task_str) {
        if (!this.csv_dir || this.daily_csv_map.get(new_task_str)) return;

        let val = this.daily_csv_map.get(old_task_str);

        if (! val) return;

        this.daily_csv_map.delete(old_task_str);
        this.daily_csv_map.set(new_task_str, val);

        // We would like to delete the old task from the stats entries, but we
        // can't tell whether or not we tracked the old task on days prior to
        // today.
        // We clear the cached stats data to let get_stats() rebuild it.
        this.stats_unique_entries.clear();
        this.stats_data.clear();

        this._write_daily_csv_file();
    },

    get_csv_dir_path: function () {
        try {
            let d = this.delegate.settings.get_value('todo-current').deep_unpack().csv_dir;
            let error;

            if (d) [d, error] = GLib.filename_from_uri(d, null);

            if (error) return null;
            else       return d;
        }
        catch (e) { logError(e); }
    },

    // NOTE: The returned values are cached, use for READ-ONLY!
    //
    // returns: [@stats_data, @stats_unique_entries]
    //
    // @stats_data: Map
    //   - @key: string (date in 'yyyy-mm-dd' iso format)
    //   - @val: Map
    //       - @key: string (a project or task)
    //       - @val: int    (minutes spent working on task/project that date)
    //
    // @stats_unique_entries: Set (of all unique tasks/projects)
    //
    // The keys in @stats_data are sorted from newest to oldest.
    // In each @val inside @stats_data, the projects are sorted after tasks.
    get_stats: function () {
        if (!this.csv_dir) return null;

        // update todays data
        {
            let today       = G.date_yyyymmdd();
            let stats_today = [];

            for (let [k, v] of this.daily_csv_map) {
                this.stats_unique_entries.add(k);

                let time = Math.floor(v.time / 60000000);

                if (v.type === '++') stats_today.push([k, time]);
                else                 stats_today.unshift([k, time]);
            }

            this.stats_data.set(today, new Map(stats_today));
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
            }
            catch (e) { file_enum = null; }

            if (file_enum !== null) {
                let info;

                while ((info = file_enum.next_file(null))) {
                    if (! reg.test(info.get_name())) continue;
                    csv_files.push([file_enum.get_child(info), info.get_name()]);
                }
            }

            csv_files.push(
                [this.yearly_csv_file, this.yearly_csv_file.get_basename()]);

            csv_files.sort((a, b) => a[1] < b[1]);

            csv_files.forEach((it) => {
                let [, content] = it[0].load_contents(null);
                content         = String(content).split(/\n|\r/);

                let string, date, entry, time;

                let i = content.length;
                while (i--) {
                    it = content[i];

                    if (!it) continue;

                    date   = it.substr(0, 10);
                    time   = +(it.substr(12, 2)) * 60 + +(it.substr(15, 2));
                    string = it.slice(24, -1).replace(/""/g, '"');

                    entry  = this.stats_data.get(date);

                    this.stats_unique_entries.add(string);

                    if (entry)
                        entry.set(string, time);
                    else
                        this.stats_data.set(date, new Map([ [string, time] ]));
                }
            });
        }

        return [this.stats_data, this.stats_unique_entries];
    },

    close: function () {
        this.stop_all_tracking();

        this._write_daily_csv_file();

        this.daily_csv_map.clear();
        this.stats_data.clear();
        this.stats_unique_entries.clear();
        this.dbus_impl.unexport();

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
    },
});
Signals.addSignalMethods(TimeTracker.prototype);
