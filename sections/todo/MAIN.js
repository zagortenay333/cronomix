const St           = imports.gi.St;
const Gio          = imports.gi.Gio
const Gtk          = imports.gi.Gtk;
const GLib         = imports.gi.GLib;
const Clutter      = imports.gi.Clutter;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Main         = imports.ui.main;
const ByteArray = imports.byteArray;
const Signals      = imports.signals;
const Mainloop     = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SIG_MANAGER  = ME.imports.lib.signal_manager;
const KEY_MANAGER  = ME.imports.lib.keybinding_manager;
const MISC_UTILS   = ME.imports.lib.misc_utils;


const G = ME.imports.sections.todo.GLOBAL;


const TASK                 = ME.imports.sections.todo.task_item;
const VIEW_MANAGER         = ME.imports.sections.todo.view_manager;
const TIME_TRACKER         = ME.imports.sections.todo.time_tracker;

const VIEW_STATS           = ME.imports.sections.todo.view__stats;
const VIEW_CLEAR           = ME.imports.sections.todo.view__clear_tasks;
const VIEW_SORT            = ME.imports.sections.todo.view__sort;
const VIEW_DEFAULT         = ME.imports.sections.todo.view__default;
const VIEW_SEARCH          = ME.imports.sections.todo.view__search;
const VIEW_LOADING         = ME.imports.sections.todo.view__loading;
const VIEW_FILTERS         = ME.imports.sections.todo.view__filters;
const VIEW_TASK_EDITOR     = ME.imports.sections.todo.view__task_editor;
const VIEW_FILE_SWITCHER   = ME.imports.sections.todo.view__file_switcher;
const VIEW_KANBAN_SWITCHER = ME.imports.sections.todo.view__kanban_switcher;


const CACHE_FILE = '~/.cache/timepp_gnome_shell_extension/timepp_todo.json';


// =====================================================================
// @@@ Main
//
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
//
// @signals:
//   - 'new-day' (new day started) (returns string in yyyy-mm-dd iso format)
//   - 'tasks-changed'
// =====================================================================
var SectionMain = class SectionMain extends ME.imports.sections.section_base.SectionBase {
    constructor (section_name, ext, settings) {
        super(section_name, ext, settings);
        this.actor.add_style_class_name('todo-section');

        this.separate_menu = this.settings.get_boolean('todo-separate-menu');

        this.cache_file   = null;
        this.cache        = null;
        this.sigm         = new SIG_MANAGER.SignalManager();
        this.keym         = new KEY_MANAGER.KeybindingManager(this.settings);
        this.time_tracker = null;

        this.view_manager = new VIEW_MANAGER.ViewManager(this.ext, this);

        // The view manager only allows one view to be visible at a time; however,
        // since the stats view uses the fullscreen iface, it is orthogonal to
        // the other views, so we don't use the view manager for it.
        this.stats_view = new VIEW_STATS.StatsView(this.ext, this, 0);


        //
        // init cache file
        //
        try {
            this.cache_file = MISC_UTILS.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].todo;

            if (this.cache_file.query_exists(null)) {
                let [, contents] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(ByteArray.toString(contents));
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                this.cache = {
                    format_version: cache_format_version,

                    // array [of G.TODO_RECORD]
                    todo_files: [],
                };
            }
        } catch (e) {
            logError(e);
            return;
        }


        this.create_tasks_mainloop_id = null;


        // We use this for tracking when a new day begins.
        this.wallclock = new GnomeDesktop.WallClock();


        // Track how many tasks have a particular proj/context/prio, a
        this.stats = null;
        this._reset_stats_obj();


        // ref to current todo record in cache file
        this.current_todo_file = null;


        // A GFile to the todo.txt file, GMonitor.
        this.todo_txt_file     = null;
        this.todo_file_monitor = null;


        // All task objects.
        this.tasks = [];


        //
        // keybindings
        //
        this.keym.add('todo-keybinding-open', () => {
            this.ext.open_menu(this.section_name);
            this.show_view__default();
        });
        this.keym.add('todo-keybinding-open-to-add', () => {
            this.ext.open_menu(this.section_name);
            this.show_view__task_editor();
        });
        this.keym.add('todo-keybinding-open-to-search', () => {
            this.ext.open_menu(this.section_name);
            this.show_view__search();
        });
        this.keym.add('todo-keybinding-open-to-stats', () => {
            this.show_view__time_tracker_stats();
        });
        this.keym.add('todo-keybinding-open-to-switch-files', () => {
            this.ext.open_menu(this.section_name);
            this.show_view__file_switcher();
        });
        this.keym.add('todo-keybinding-open-todotxt-file', () => {
            if (! this.todo_txt_file) return;
            let path = this.todo_txt_file.get_path();
            if (path) MISC_UTILS.open_file_path(path);
        });


        //
        // panel item
        //
        this.panel_item.actor.add_style_class_name('todo-panel-item');
        this.panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-todo-symbolic');
        this._toggle_panel_item_mode();


        //
        // listen
        //
        this.sigm.connect(this.settings, 'changed::todo-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('todo-separate-menu');
            this.ext.update_panel_items();
        });
        this.sigm.connect(this.settings, 'changed::todo-task-width', () => {
            let width = this.settings.get_int('todo-task-width');
            for (let task of this.tasks) task.actor.width = width;
        });
        this.sigm.connect(this.wallclock, 'notify::clock', () => {
            let t = GLib.DateTime.new_now(this.wallclock.timezone);
            t     = t.format('%H:%M');
            if (t === '00:00') this._on_new_day_started();
        });
        this.sigm.connect(this.settings, 'changed::todo-panel-mode', () => this._toggle_panel_item_mode());
        this.sigm.connect(this.ext, 'custom-css-changed', () => this._on_custom_css_changed());

        //
        // finally
        //
        this._init_todo_file();
    }

    disable_section () {
        if (this.create_tasks_mainloop_id) {
            Mainloop.source_remove(this.create_tasks_mainloop_id);
            this.create_tasks_mainloop_id = null;
        }

        if (this.time_tracker) {
            this.time_tracker.close();
            this.time_tracker = null;
        }

        if (this.stats_view) {
            this.stats_view.destroy();
            this.stats_view = null;
        }

        this._disable_todo_file_monitor();
        this.sigm.clear();
        this.keym.clear();

        this.view_manager.close_current_view();
        this.view_manager      = null;
        this.tasks             = [];

        super.disable_section();
    }

    _init_todo_file () {
        this.show_view__loading(true);
        this.view_manager.lock = true;

        // reset
        {
            if (this.create_tasks_mainloop_id) {
                Mainloop.source_remove(this.create_tasks_mainloop_id);
                this.create_tasks_mainloop_id = null;
            }

            if (this.time_tracker) {
                this.time_tracker.close();
                this.time_tracker = null;
            }

            if (this.todo_file_monitor) {
                this.todo_file_monitor.cancel();
                this.todo_file_monitor = null;
            }

            this.stats.priorities.clear();
            this.stats.contexts.clear();
            this.stats.projects.clear();
        }

        try {
            if (this.cache.todo_files.length === 0) {
                this.show_view__file_switcher(true);
                this.view_manager.lock = true;
                return;
            }

            this.current_todo_file = null;
            let current = this.get_current_todo_file();

            if (!current) {
                this.show_view__file_switcher(true);
                this.view_manager.lock = true;
                return;
            }

            this.todo_txt_file = MISC_UTILS.file_new_for_path(current.todo_file);
            if (! this.todo_txt_file.query_exists(null)) this.todo_txt_file.create(Gio.FileCreateFlags.NONE, null);
            this._enable_todo_file_monitor();
        } catch (e) {
            this.show_view__file_switcher(true);
            this.view_manager.lock = true;
            logError(e);
            Main.notify(_('Unable to load todo file'));
            return;
        }

        let [, lines] = this.todo_txt_file.load_contents(null);
        lines = ByteArray.toString(lines).split(/\r?\n/).filter((l) => /\S/.test(l));

        this.create_tasks(lines, () => {
            let needs_write = this._check_dates();
            this.on_tasks_changed(needs_write);
            this.time_tracker = new TIME_TRACKER.TimeTracker(this.ext, this);
        });
    }

    _disable_todo_file_monitor () {
        if (this.todo_file_monitor) {
            this.todo_file_monitor.cancel();
            this.todo_file_monitor = null;
        }
    }

    _enable_todo_file_monitor () {
        [this.todo_file_monitor,] =
            MISC_UTILS.file_monitor(this.todo_txt_file, () => this._on_todo_file_changed());
    }

    store_cache () {
        if (! this.cache_file) return;

        if(! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    get_current_todo_file () {
        if (this.current_todo_file) return this.current_todo_file;

        for (let it of this.cache.todo_files) {
            if (it.active) {
                this.current_todo_file = it;
                break;
            }
        }

        return this.current_todo_file;
    }

    write_tasks_to_file () {
        this._disable_todo_file_monitor();

        let content = '';
        for (let it of this.tasks) content += it.task_str + '\n';

        this.todo_txt_file.replace_contents(content, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        this._enable_todo_file_monitor();
    }

    _on_todo_file_changed (event_type) {
        this._init_todo_file();
    }

    _on_new_day_started () {
        this.emit('new-day', MISC_UTILS.date_yyyymmdd());
        if (this._check_dates()) this.on_tasks_changed(true, true);
    }

    _check_dates () {
        let today          = MISC_UTILS.date_yyyymmdd();
        let tasks_updated  = false;
        let recurred_tasks = 0;
        let deferred_tasks = 0;

        for (let task of this.tasks) {
            if (task.check_recurrence()) {
                tasks_updated = true;
                recurred_tasks++;
            }

            if (task.check_deferred_tasks(today)) {
                tasks_updated = true;
                deferred_tasks++;
            }

            task.update_dates_markup();
        }

        if (tasks_updated) {
            if (recurred_tasks > 0) {
                Main.notify(ngettext('%d task has recurred',
                                     '%d tasks have recurred',
                                      recurred_tasks).format(recurred_tasks));
            }

            if (deferred_tasks > 0) {
                Main.notify(ngettext('%d deferred task has been opened',
                                     '%d deferred tasks have been opened',
                                      deferred_tasks).format(deferred_tasks));
            }
        }

        return tasks_updated;
    }

    _on_custom_css_changed () {
        for (let task of this.tasks) {
            task.update_body_markup();
            task.update_dates_markup();
        }
    }

    // The maps have the structure:
    // @key : string  (a context/project/priority)
    // @val : natural (number of tasks that have that @key)
    _reset_stats_obj () {
        this.stats = {
            deferred_tasks        : 0,
            recurring_completed   : 0,
            recurring_incompleted : 0,
            hidden                : 0,
            completed             : 0,
            no_priority           : 0,
            priorities            : new Map(),
            contexts              : new Map(),
            projects              : new Map(),
        };
    }

    _toggle_panel_item_mode () {
        if (this.settings.get_enum('todo-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('todo-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    }

    // Create task objects from the given task strings and add them to the
    // this.tasks array.
    //
    // Make sure to call this.on_tasks_changed() soon after calling this func.
    //
    // @todo_strings : array (of strings; each string is a line in todo.txt file)
    // @callback     : func
    create_tasks (todo_strings, callback) {
        if (this.create_tasks_mainloop_id) {
            Mainloop.source_remove(this.create_tasks_mainloop_id);
            this.create_tasks_mainloop_id = null;
        }

        // Since we are reusing already instantiated objects, get rid of any
        // excess task object.
        //
        // @NOTE Reusing old objects can be the source of evil...
        {
            let len = todo_strings.length;
            while (this.tasks.length > len) this.tasks.pop().actor.destroy();
        }

        this.create_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._create_tasks__finish(0, todo_strings, callback);
        });
    }

    _create_tasks__finish (i, todo_strings, callback) {
        if (i === todo_strings.length) {
            if (typeof(callback) === 'function') callback();
            this.create_tasks_mainloop_id = null;
            return;
        }

        let str = todo_strings[i];

        if (this.tasks[i])
            this.tasks[i].reset(false, str);
        else
            this.tasks.push(new TASK.TaskItem(this.ext, this, str, false));

        this.create_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._create_tasks__finish(++i, todo_strings, callback);
        });
    }

    on_tasks_changed (write_to_file = true, refresh_default_view = false) {
        //
        // Update stats obj
        //
        {
            this._reset_stats_obj();

            let n, proj, context;

            for (let task of this.tasks) {
                if (task.is_deferred) {
                    this.stats.deferred_tasks++;
                    continue;
                }

                if (task.completed) {
                    if (task.rec_str) this.stats.recurring_completed++
                    else              this.stats.completed++;
                    continue;
                }

                for (proj of task.projects) {
                    n = this.stats.projects.get(proj);
                    this.stats.projects.set(proj, n ? ++n : 1);
                }

                for (context of task.contexts) {
                    n = this.stats.contexts.get(context);
                    this.stats.contexts.set(context, n ? ++n : 1);
                }

                if (task.hidden) {
                    this.stats.hidden++;
                    continue;
                }

                if (task.priority === '(_)') {
                    this.stats.no_priority++;
                } else {
                    n = this.stats.priorities.get(task.priority);
                    this.stats.priorities.set(task.priority, n ? ++n : 1);
                }

                if (task.rec_str) this.stats.recurring_incompleted++;
            }
        }


        //
        // update panel label
        //
        {
            let n_incompleted = this.tasks.length -
                                this.stats.completed -
                                this.stats.hidden -
                                this.stats.recurring_completed -
                                this.stats.deferred_tasks;

            this.panel_item.set_label('' + n_incompleted);

            if (n_incompleted) this.panel_item.actor.remove_style_class_name('done');
            else               this.panel_item.actor.add_style_class_name('done');
        }


        //
        // Since contexts/projects/priorities are filters, it can happen that we
        // have redundant filters in case tasks were deleted. Clean 'em up.
        //
        {
            let current = this.get_current_todo_file();
            let i, arr, len;

            arr = current.filters.priorities;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.priorities.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }

            arr = current.filters.contexts;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.contexts.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }

            arr = current.filters.projects;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.projects.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }
        }

        this.sort_tasks();
        this.show_view__default(true, refresh_default_view);
        if (write_to_file) this.write_tasks_to_file();

        this.emit('tasks-changed');
    }

    sort_tasks () {
        if (! this.get_current_todo_file().automatic_sort) return;

        let property_map = {
            [G.SortType.PIN]             : 'pinned',
            [G.SortType.CONTEXT]         : 'first_context',
            [G.SortType.PROJECT]         : 'first_project',
            [G.SortType.PRIORITY]        : 'priority',
            [G.SortType.COMPLETED]       : 'completed',
            [G.SortType.DUE_DATE]        : 'due_date',
            [G.SortType.ALPHABET]        : 'msg_text',
            [G.SortType.RECURRENCE]      : 'rec_next',
            [G.SortType.CREATION_DATE]   : 'creation_date',
            [G.SortType.COMPLETION_DATE] : 'completion_date',
        };

        let sort  = this.get_current_todo_file().sorts;
        let i     = 0;
        let len   = sort.length;
        let props = Array(len);

        for (; i < len; i++) {
            props[i] = property_map[ sort[i][0] ];
        }

        this.tasks.sort((a, b) => {
            let x, y;

            for (i = 0; (i < len) && (x = a[props[i]]) === (y = b[props[i]]); i++);

            if (i === len) return 0;

            switch (sort[i][0]) {
              case G.SortType.PRIORITY:
                if (sort[i][1] === G.SortOrder.DESCENDING) return +(x > y) || +(x === y) - 1;
                else                                       return +(x < y) || +(x === y) - 1;
              default:
                if (sort[i][1] === G.SortOrder.DESCENDING) return +(x < y) || +(x === y) - 1;
                else                                       return +(x > y) || +(x === y) - 1;
            }
        });
    }

    // Append the task strings of each given task to the current done.txt file.
    //
    // If a given task is not completed, it's task string will be updated to
    // show that it's completed prior to been appended to the done.txt file.
    //
    // The task objects will not be changed.
    //
    // @tasks: array (of task objects)
    archive_tasks (tasks) {
        let content = '';
        let today   = MISC_UTILS.date_yyyymmdd();

        for (let task of tasks) {
            if (task.completed) {
                content += task.task_str + '\n';
            } else if (task.priority === '(_)') {
                content += `x ${today} ${task.task_str}\n`;
            } else {
                content += `x ${today} ${task.task_str.slice(3)} pri:${task.priority[1]}\n`;
            }
        }

        try {
            let current = this.get_current_todo_file();

            if (!current || !current.done_file) return;

            let done_file     = MISC_UTILS.file_new_for_path(current.done_file);
            let append_stream = done_file.append_to(Gio.FileCreateFlags.NONE, null);

            append_stream.write_all(content, null);
        } catch (e) { logError(e); }
    }

    show_view__default (unlock = false, force_refresh = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        if (!force_refresh && this.view_manager.current_view_name === G.View.DEFAULT) {
            Mainloop.idle_add(() => this.view_manager.current_view.dummy_focus_actor.grab_key_focus());
            return;
        }

        this.view_manager.close_current_view();

        let view = new VIEW_DEFAULT.ViewDefault(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.DEFAULT,
            actors         : [view.actor],
            focused_actor  : view.dummy_focus_actor,
            close_callback : () => view.close(),
        });
    }

    show_view__time_tracker_stats (task) {
        if (! this.time_tracker) return;

        this.ext.menu.close();
        this.stats_view.open();

        if (this.time_tracker.stats_data.size === 0)
            this.stats_view.show_mode__banner(_('Loading...'));

        Mainloop.idle_add(() => {
            let stats = this.time_tracker.get_stats();

            if (!stats) {
                this.stats_view.show_mode__banner(_('Nothing found.'));
            } else if (!task) {
                this.stats_view.set_stats(...stats);
                this.stats_view.show_mode__global(MISC_UTILS.date_yyyymmdd());
            } else {
                this.stats_view.set_stats(...stats);
                let d = new Date();
                this.stats_view.show_mode__single(d.getFullYear(), d.getMonth(), task.task_str, '()');
            }
        });
    }

    show_view__loading (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        this.panel_item.set_mode('icon');
        this.panel_item.actor.remove_style_class_name('done');
        this.panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-todo-loading-symbolic');

        let view = new VIEW_LOADING.ViewLoading(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.LOADING,
            actors         : [view.actor],
            focused_actor  : view.loading_msg,
            close_callback : () => {
                view.close();
                this.panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-todo-symbolic');
                this._toggle_panel_item_mode();
            }
        });
    }

    show_view__search (search_str = false, unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        this.view_manager.close_current_view();

        let view = new VIEW_SEARCH.ViewSearch(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.SEARCH,
            focused_actor  : view.search_entry,
            actors         : [view.actor],
            close_callback : () => view.close(),
        });

        if (search_str) view.search_entry.text = search_str;
    }

    show_view__kanban_switcher (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        let view = new VIEW_KANBAN_SWITCHER.KanbanSwitcher(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.KANBAN_SWITCHER,
            actors         : [view.actor],
            focused_actor  : view.entry,
            close_callback : () => view.close(),
        });
    }

    show_view__clear_completed (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        let view = new VIEW_CLEAR.ViewClearTasks(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.CLEAR,
            actors         : [view.actor],
            focused_actor  : view.button_cancel,
            close_callback : () => view.close(),
        });

        view.connect('delete-all', () => {
            let incompleted_tasks = [];

            for (let i = 0, len = this.tasks.length; i < len; i++) {
                if (!this.tasks[i].completed || this.tasks[i].rec_str)
                    incompleted_tasks.push(this.tasks[i]);
            }

            this.tasks = incompleted_tasks;
            this.on_tasks_changed();
        });

        view.connect('archive-all', () => {
            let completed_tasks   = [];
            let incompleted_tasks = [];

            for (let task of this.tasks) {
                if (!task.completed || task.rec_str) incompleted_tasks.push(task);
                else                                 completed_tasks.push(task);
            }

            this.archive_tasks(completed_tasks);
            this.tasks = incompleted_tasks;
            this.on_tasks_changed();
        });

        view.connect('cancel', () => {
            this.show_view__default();
        });
    }

    show_view__file_switcher (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        let view = new VIEW_FILE_SWITCHER.ViewFileSwitcher(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.FILE_SWITCH,
            actors         : [view.actor],
            focused_actor  : this.cache.todo_files.length ? view.entry : view.button_add_file,
            close_callback : () => view.close(),
        });

        if (this.cache.todo_files.length === 0) this.panel_item.set_mode('icon');

        view.connect('update', (_, files) => {
            this.cache.todo_files = files;
            this.store_cache();
            Main.panel.menuManager.ignoreRelease();
            this._init_todo_file();
        });

        view.connect('cancel', () => {
            this.show_view__default();
        });
    }

    show_view__sort (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        let view = new VIEW_SORT.ViewSort(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.SELECT_SORT,
            actors         : [view.actor],
            focused_actor  : view.button_ok,
            close_callback : () => view.close(),
        });

        view.connect('update-sort', (_, new_sort, automatic_sort) => {
            let current            = this.get_current_todo_file();
            current.sorts          = new_sort;
            current.automatic_sort = automatic_sort;

            this.sort_tasks();
            this.store_cache();
            this.show_view__default();
        });
    }

    show_view__filters (unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        let view = new VIEW_FILTERS.ViewFilters(this.ext, this);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.SELECT_FILTER,
            actors         : [view.actor],
            focused_actor  : view.entry.entry,
            close_callback : () => view.close(),
        });

        view.connect('filters-updated', (_, filters) => {
            this.get_current_todo_file().filters = filters;
            this.store_cache();
            this.show_view__default();
        });
    }

    show_view__task_editor (task, unlock = false) {
        if (unlock) this.view_manager.lock = false;
        else if (this.view_manager.lock) return;

        this.view_manager.lock = true;

        let view = new VIEW_TASK_EDITOR.ViewTaskEditor(this.ext, this, task);

        this.view_manager.show_view({
            view           : view,
            view_name      : G.View.EDITOR,
            actors         : [view.actor],
            focused_actor  : view.entry.entry,
            close_callback : () => view.close(),
        });

        if (task) this.time_tracker.stop_tracking(task);

        view.connect('delete-task', (_, do_archive) => {
            if (do_archive) this.archive_tasks([task]);

            for (let i = 0, len = this.tasks.length; i < len; i++) {
                if (this.tasks[i] === task) {
                    this.tasks.splice(i, 1);
                    break;
                }
            }

            this.on_tasks_changed();
        });

        view.connect('add-task', (_, task) => {
            this.tasks.push(task);
            this.on_tasks_changed();
        });

        view.connect('edited-task', () => {
            this.on_tasks_changed();
        });

        view.connect('cancel', () => {
            this.show_view__default(true);
        });
    }
}
Signals.addSignalMethods(SectionMain.prototype);
