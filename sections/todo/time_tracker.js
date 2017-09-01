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


const G = ME.imports.sections.todo.GLOBAL;


const TIME_TRACKER_DBUS_IFACE =
    '<node>                                                 \
        <interface name="timepp.zagortenay333.TimeTracker"> \
            <method name="stop_all_tracking">               \
            </method>                                       \
                                                            \
            <method name="stop_tracking_by_id">             \
                <arg type="s" direction="in"/>              \
            </method>                                       \
                                                            \
            <method name="start_tracking_by_id">            \
                <arg type="s" direction="in"/>              \
            </method>                                       \
        </interface>                                        \
    </node>';


// =====================================================================
// @@@ Time tracker
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
const TimeTracker = new Lang.Class({
    Name: 'Timepp.TimeTracker',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(TIME_TRACKER_DBUS_IFACE, this);
        this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/TimeTracker');

        this.csv_dir = delegate.settings.get_value('todo-current')
                       .deep_unpack().csv_dir;

        if (this.csv_dir) {
            [this.csv_dir, ] = GLib.filename_from_uri(this.csv_dir, null);
        }

        this.number_of_tracked_tasks = 0;
        this.tracker_tic_id          = null;

        // GFiles
        this.yearly_csv_dir  = null;
        this.yearly_csv_file = null;
        this.daily_csv_file  = null;

        // GFileMonitors
        this.yearly_csv_dir_monitor  = null;
        this.yearly_csv_file_monitor = null;
        this.daily_csv_file_monitor  = null;

        this.daily_csv_file_monitor_handler_block = false;

        // The stats data is cached with the exception of today's stats which
        // get appended.
        this.stats_data           = new Map();
        this.stats_unique_entries = new Set();


        // The structure of the daily map is:
        //
        // @key:
        //   is a string which is either a task string (a single line in the
        //   todo.txt file) or a project keyword (e.g., '+my_project', '+stuff',
        //   etc...)
        //
        // @val:
        //   is an object of the form: { time     : int,
        //                               tracking : bool,
        //                               type     : string, }
        //
        //   If the type is '++' (a project), then the @val obj will have the
        //   additional property: tracked_children (int).
        //
        //   If the type is '()' (a task), then the @val object will have the
        //   additional property: task_ref (obj).
        //
        //   @time     : time tracked in seconds.
        //   @tracking : indicates whether the entry is being tracked.
        //   @type     : indicates whether the entry is a project or task.
        //
        //   @task_ref         : the ref of the corresponding task object.
        //   @tracked_children : number of tasks that are part of this project
        //                       and that are being tracked.
        this.daily_csv_map = new Map();


        this._init_tracker_dir();


        //
        // listen
        //
        this.delegate.connect('new-day', () => {
            this._archive_daily_csv_file();
        });
        this.ext.connect('stop-time-tracking', () => {
            this.stop_all_tracking();
        });
        delegate.settings.connect('changed::todo-current', () => {
            this.csv_dir = delegate.settings.get_value('todo-current')
                           .deep_unpack().csv_dir;

            if (this.csv_dir) {
                [this.csv_dir, ] = GLib.filename_from_uri(this.csv_dir, null);
            }

            this._init_tracker_dir();
        });
    },

    _tracker_tic: function () {
        if (this.number_of_tracked_tasks === 0) {
            this.tracker_tic_id = null;
            return;
        }

        let min = arguments[0] || 1;

        this.tracker_tic_id = Mainloop.timeout_add_seconds(1, () => {
            for (let v of this.daily_csv_map.values()) {
                if (v.tracking) {
                    v.time++;
                    log(v.time);
                }
            }

            if (min === 60) {
                min = 0;
                Mainloop.idle_add(() => this._write_daily_csv_file());
            }

            this._tracker_tic(++min);
        });
    },

    // This func will:
    //  - Reset the time tracker.
    //  - If the user has specified a time tracker dir:
    //      - Ensure that the tracker dir has the daily csv file, yearly csv
    //        file, and yearly csv dir in it.
    //      - Ensure that all GFileMonitors are active.
    //      - Ensure that the daily_csv_map is initialized.
    _init_tracker_dir: function () {
        // reset
        {
            this.stop_all_tracking();
            this.daily_csv_map.clear();
            this.stats_data.clear();
            this.stats_unique_entries.clear();

            if (this.tracker_tic_id) {
                Mainloop.source_remove(this.tracker_tic_id);
                this.tracker_tic_id = null;
            }

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
        }


        if (! this.csv_dir) return;


        let d = new Date();


        // ensure the yearly dir, yearly file, daily file, and their monitors
        try {
            // yearly dir
            this.yearly_csv_dir = Gio.file_new_for_path(
                `${this.csv_dir}/YEARS__time_tracker`);

            if (! this.yearly_csv_dir.query_exists(null))
                this.yearly_csv_dir.make_directory_with_parents(null);

            this.yearly_csv_dir_monitor = this.yearly_csv_dir.monitor_directory(
                Gio.FileMonitorFlags.NONE, null);

            this.yearly_csv_dir_monitor.connect('changed', () => {
                this._on_yearly_csv_dir_changed();
            });


            // yearly file
            this.yearly_csv_file = Gio.file_new_for_path(
                `${this.csv_dir}/${d.getFullYear()}__time_tracker.csv`);

            if (! this.yearly_csv_file.query_exists(null))
                this.yearly_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.yearly_csv_file_monitor = this.yearly_csv_file.monitor_file(
                Gio.FileMonitorFlags.NONE, null);

            this.yearly_csv_file_monitor.connect('changed', () => {
                this._on_yearly_csv_file_changed();
            });


            // daily file
            this.daily_csv_file = Gio.file_new_for_path(
                `${this.csv_dir}/TODAY__time_tracker.csv`);

            if (! this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.daily_csv_file_monitor = this.daily_csv_file.monitor_file(
                Gio.FileMonitorFlags.NONE, null);

            this.daily_csv_file_monitor.connect('changed', () => {
                this._on_daily_csv_file_changed();
            });
        }
        catch (e) {
            logError(e);
            return;
        }

        // check to see if the yearly csv file needs to be archived
        {
            let prev_f =
                `${this.csv_dir}/${d.getFullYear() - 1}__time_tracker.csv`;

            if (GLib.file_test(prev_f, GLib.FileTest.EXISTS)) {
                let dir = `${this.csv_dir}/YEARS__time_tracker`;
                Util.spawnCommandLine(`mv ${prev_f} ${dir}`);
            }
        }

        // init daily csv map
        {
            let [, contents] = this.daily_csv_file.load_contents(null);
            contents = String(contents).trim().split(/\n|\r/);

            // Check whether we need to archive the daily file.
            for (let i = 0, len = contents.length; i < len; i++) {
                if (contents[i] === '') continue;

                if (contents[i].substr(0, 10) !== G.date_yyyymmdd(d)) {
                    this._archive_daily_csv_file();
                    return;
                }
            }

            for (let i = 0, len = contents.length; i < len; i++) {
                let it = contents[i].trim();

                if (it === '') continue;

                let key  = it.substring(24, it.length - 1).replace(/""/g, '"');
                let type = it.substr(19, 2);

                this.daily_csv_map.set(key, {
                    time : +(it.substr(12, 2)) * 3600 + (+(it.substr(15, 2)) * 60),
                    tracking : false,
                    type     : type,
                });

                if (type === '++')
                    this.daily_csv_map.get(key).tracked_children = 0;
                else
                    this.daily_csv_map.get(key).task_ref = null;
            }
        }
    },

    _on_yearly_csv_dir_changed: function () {
        this._init_tracker_dir();
    },

    _on_yearly_csv_file_changed: function () {
        this._init_tracker_dir();
    },

    _on_daily_csv_file_changed: function () {
        // @HACK
        // The normal handler_block/unblock methods don't work with a file
        // monitor for some reason.
        if (this.daily_csv_file_monitor_handler_block) {
            Mainloop.idle_add(() => {
                this.daily_csv_file_monitor_handler_block = false;
            });
            return;
        }

        this._init_tracker_dir();
    },

    _write_daily_csv_file: function () {
        // We don't need to reinitialize the tracker dir here.
        this.daily_csv_file_monitor_handler_block = true;

        let d        = G.date_yyyymmdd();
        let projects = '';
        let tasks    = '';

        for (let [k, v] of this.daily_csv_map.entries()) {
            if (v.time < 60) continue;

            let hh = Math.floor(v.time / 3600);
            hh     = (hh < 10) ? ('0' + hh) : ('' + hh);

            let mm = Math.round(v.time % 3600 / 60);
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
        catch (e) { this._init_tracker_dir(); }
    },

    _archive_daily_csv_file: function () {
        try {
            let [, contents]  = this.daily_csv_file.load_contents(null);

            let append_stream = this.yearly_csv_file.append_to(
                Gio.FileCreateFlags.NONE, null);

            append_stream.write_all(contents, null);

            this.daily_csv_file.replace_contents('', null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }
        catch (e) { this._init_tracker_dir(); }

        let d = G.date_yyyymmdd();

        for (let v of this.daily_csv_map.values()) {
            v.date = d;
            v.time = 0;
        }
    },

    _get_week_start_date: function () {
        let d       = new Date();
        let day_pos = (7 - Shell.util_get_week_start() + d.getDay()) % 7;

        d.setDate(d.getDate() - day_pos + 1);

        return d.toISOString().substr(0, 10);
    },

    stop_all_tracking: function () {
        if (!this.csv_dir) return;

        this.number_of_tracked_tasks = 0;

        for (let [k, v] of this.daily_csv_map.entries()) {
            if (v.tracking) {
                v.tracking = false;
                if (v.type === '()') v.task_ref.on_tracker_stopped();
            }
        }

        this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    toggle_tracking: function (task) {
        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) this.stop_tracking(task);
        else                     this.start_tracking(task);
    },

    start_tracking_by_id: function (id) {
        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].tracker_id === id) {
                this.start_tracking(this.delegate.tasks[i]);
            }
        }
    },

    stop_tracking_by_id: function (id) {
        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].tracker_id === id) {
                this.stop_tracking(this.delegate.tasks[i]);
            }
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

        if (val) {
            val.tracking = true;
            val.task_ref = task;
        }
        else {
            this.daily_csv_map.set(task.task_str, {
                time     : 0,
                tracking : true,
                type     : '()',
                task_ref : task,
            });
        }

        for (let i = 0, len = task.projects.length; i < len; i++) {
            val = this.daily_csv_map.get(task.projects[i]);

            if (val) {
                val.tracking = true;
                val.tracked_children++;
            }
            else {
                this.daily_csv_map.set(task.projects[i], {
                    time             : 0,
                    tracking         : true,
                    type             : '++',
                    tracked_children : 1,
                });
            }
        }

        this.number_of_tracked_tasks++;
        if (! this.tracker_tic_id) this._tracker_tic();

        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].task_str === task.task_str)
                this.delegate.tasks[i].on_tracker_started();
        }

        this.delegate.panel_item.actor.add_style_class_name('on');
    },

    stop_tracking: function (task) {
        if (!this.csv_dir) return null;

        let val = this.daily_csv_map.get(task.task_str);

        if (!val || !val.tracking) return;

        val.tracking = false;
        this.number_of_tracked_tasks--;

        let proj;

        for (let i = 0, len = task.projects.length; i < len; i++) {
            proj = this.daily_csv_map.get(task.projects[i]);
            if (--proj.tracked_children === 0) proj.tracking = false;
        }

        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].task_str === task.task_str)
                this.delegate.tasks[i].on_tracker_stopped();
        }

        if (this.number_of_tracked_tasks === 0)
            this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    // Swap the old_task_str with the new_task_str in the daily_csv_map only.
    // The time tracked on the old_task_str is copied over to the new_task_str.
    update_record_name: function (old_task_str, new_task_str) {
        if (!this.csv_dir) return null;

        this.stats_unique_entries.delete(old_task_str);

        let val = this.daily_csv_map.get(old_task_str);

        if (! val) return;

        this.daily_csv_map.set(new_task_str, val);
        this.daily_csv_map.delete(old_task_str);

        this._write_daily_csv_file();
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

            for (let [k, v] of this.daily_csv_map.entries()) {
                this.stats_unique_entries.add(k);

                let time = Math.floor(v.time / 60);

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

        if (this.tracker_tic_id) {
            Mainloop.source_remove(this.tracker_tic_id);
            this.tracker_tic_id = null;
        }
    },
});
Signals.addSignalMethods(TimeTracker.prototype);
