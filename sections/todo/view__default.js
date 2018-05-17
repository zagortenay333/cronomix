const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const Lang      = imports.lang;
const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SIG_MANAGER = ME.imports.lib.signal_manager;
const MISC_UTILS  = ME.imports.lib.misc_utils;
const FUZZ        = ME.imports.lib.fuzzy_search;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewDefault
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
// =====================================================================
var ViewDefault = new Lang.Class({
    Name: 'Timepp.ViewDefault',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        this.sigm = new SIG_MANAGER.SignalManager();

        this.add_tasks_to_menu_mainloop_id = null;
        this.tasks_viewport = [];

        this.needs_filtering = true;
        this.automatic_sort  = this.delegate.get_current_todo_file().automatic_sort;


        //
        // draw
        //
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'view-default' });

        this.content_box = new St.BoxLayout({ x_expand: true, y_expand: true, vertical: true, });
        this.actor.add_actor(this.content_box);


        //
        // header
        //
        this.header = new St.BoxLayout({ x_expand: true, style_class: 'timepp-menu-item header' });
        this.content_box.add_child(this.header);

        this.add_task_button = new St.Button({ can_focus: true, x_align: St.Align.START, style_class: 'add-task' });
        this.header.add(this.add_task_button, { expand: true });

        this.add_task_bin = new St.BoxLayout();
        this.add_task_button.add_actor(this.add_task_bin);

        this.add_task_icon = new St.Icon({ icon_name: 'timepp-plus-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_icon);

        this.add_task_label = new St.Label({ text: _('Add New Task...'), y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_label);


        //
        // header icons
        //
        this.icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.add_child(this.icon_box);

        this.clear_icon = new St.Icon({ icon_name: 'timepp-clear-symbolic', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'clear-icon' });
        this.icon_box.add_child(this.clear_icon);
        this.clear_icon.visible = this.delegate.stats.completed > 0;

        this.filter_icon = new St.Icon({ can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'filter-icon' });
        this.icon_box.add_child(this.filter_icon);

        if (this._has_active_filters()) this.filter_icon.add_style_class_name('active');
        else                            this.filter_icon.remove_style_class_name('active');

        if (this.delegate.cache.filters.invert_filters) this.filter_icon.icon_name = 'timepp-filter-inverted-symbolic';
        else                                            this.filter_icon.icon_name = 'timepp-filter-symbolic';

        this.sort_icon = new St.Icon({ icon_name: 'timepp-sort-ascending-symbolic', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'sort-icon' });
        this.icon_box.add_child(this.sort_icon);
        if (this.automatic_sort) this.sort_icon.add_style_class_name('active');
        else                     this.sort_icon.remove_style_class_name('active');

        this.search_icon = new St.Icon({ icon_name: 'timepp-search-symbolic', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'search-icon' });
        this.icon_box.add_child(this.search_icon);

        this.file_switcher_icon = new St.Icon({ icon_name: 'timepp-file-symbolic', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'file-switcher-icon' });
        this.icon_box.add_child(this.file_switcher_icon);

        this.stats_icon = new St.Icon({ icon_name: 'timepp-graph-symbolic', can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'stats-icon' });
        this.icon_box.add_child(this.stats_icon);


        //
        // task items box
        //
        this.tasks_scroll = new St.ScrollView({ style_class: 'timepp-menu-item tasks-container vfade', x_fill: true, y_align: St.Align.START});
        this.content_box.add(this.tasks_scroll, {expand: true});

        this.tasks_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.tasks_scroll_content = new St.BoxLayout({ vertical: true, style_class: 'tasks-content-box'});
        this.tasks_scroll.add_actor(this.tasks_scroll_content);


        //
        // listen
        //
        this.open_state_changed_id =
            this.delegate.connect('section-open-state-changed', (_, state) => {
                if (state) this._add_tasks_to_menu();
                else       this._remove_tasks_from_menu();
            });
        this.sigm.connect_press(this.add_task_button, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__task_editor());
        this.sigm.connect_press(this.filter_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__filters());
        this.sigm.connect_on_button(this.filter_icon, Clutter.BUTTON_MIDDLE, () => this._toggle_filters());
        this.sigm.connect_press(this.file_switcher_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__file_switcher());
        this.sigm.connect_press(this.search_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__search());
        this.sigm.connect_press(this.stats_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__time_tracker_stats());
        this.sigm.connect_press(this.clear_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__clear_completed());
        this.sigm.connect_press(this.sort_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__sort());
        this.sigm.connect_on_button(this.sort_icon, Clutter.BUTTON_MIDDLE, () => this._toggle_automatic_sort());
        this.actor.connect('key-press-event', (_, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_slash:
                    this.delegate.show_view__search();
                    break;
                case Clutter.KEY_f:
                    this.delegate.show_view__file_switcher();
                    break;
                case Clutter.KEY_i:
                    this.delegate.show_view__task_editor(); break;
                    break;
                case Clutter.KEY_s:
                    this.delegate.show_view__sort();
                    break;
            }
        });

        //
        // finally
        //
        if (this.delegate.actor.visible) this._add_tasks_to_menu();
    },

    _add_tasks_to_menu: function () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.tasks_scroll_content.remove_all_children();

        let has_active_filters = this._has_active_filters();

        let arr;

        if (this.needs_filtering) {
            this.tasks_viewport = [];
            arr = this.delegate.tasks;
        } else {
            arr = this.tasks_viewport;
        }

        let n = Math.min(arr.length, 30);

        for (let i = 0; i < n; i++) {
            let it = arr[i];

            if (! this.needs_filtering) {
                this.tasks_scroll_content.add_child(it.actor);
                it.dnd.drag_enabled = !this.automatic_sort;
                it.actor_parent     = this.tasks_scroll_content;
                it.actor_scrollview = this.tasks_scroll;
                it.owner            = this;
            } else if (this._filter_test(it, has_active_filters)) {
                this.tasks_viewport.push(it);
                this.tasks_scroll_content.add_child(it.actor);
                it.dnd.drag_enabled = !this.automatic_sort;
                it.actor_parent     = this.tasks_scroll_content;
                it.actor_scrollview = this.tasks_scroll;
                it.owner            = this;
            }
        }

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
           this._add_tasks_to_menu__finish(n, arr, this.needs_filtering, has_active_filters, false);
        });
    },

    _add_tasks_to_menu__finish: function (i, arr, needs_filtering, has_active_filters, scrollbar_shown) {
        if (!scrollbar_shown && this.ext.needs_scrollbar()) {
            this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            scrollbar_shown = true;
        }

        if (i === arr.length) {
            this.needs_filtering = false;
            this.add_tasks_to_menu_mainloop_id = null;
            return;
        }

        for (let j = 0; j < 50; j++, i++) {
            if (i === arr.length) break;

            let it = arr[i];

            if (! this.needs_filtering) {
                this.tasks_scroll_content.add_child(it.actor);
                it.actor_parent     = this.tasks_scroll_content;
                it.actor_scrollview = this.tasks_scroll;
                it.owner            = this;
                it.dnd.drag_enabled = !this.automatic_sort;
            } else if (this._filter_test(it, has_active_filters)) {
                this.tasks_viewport.push(it);
                this.tasks_scroll_content.add_child(it.actor);
                it.actor_parent     = this.tasks_scroll_content;
                it.actor_scrollview = this.tasks_scroll;
                it.owner            = this;
                it.dnd.drag_enabled = !this.automatic_sort;
            }
        }

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
            this._add_tasks_to_menu__finish(i, arr, needs_filtering, has_active_filters, scrollbar_shown);
        });
    },

    _remove_tasks_from_menu: function () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this.tasks_scroll_content.remove_all_children();
    },

    // @task: obj (a task object)
    //
    // A predicate used to determine whether a task inside the this.tasks array
    // will be added to this.tasks_viewport array (i.e., whether it can be
    // visible to the user).
    //
    // If invert_filters is false, return true if at least one filter is matched.
    // If invert_filters is true,  return false if at least one filter is matched.
    _filter_test: function (task, has_active_filters) {
        let cache = this.delegate.cache;

        if (task.pinned)                    return true;
        if (cache.filters.hidden)           return task.hidden;
        if (task.hidden)                    return false;
        if (cache.filters.deferred)         return task.is_deferred;
        if (cache.filters.recurring)        return Boolean(task.rec_str);
        if (task.rec_str && task.completed) return false;
        if (task.is_deferred)               return false;
        if (! has_active_filters)           return true;

        if (task.completed) {
            if (cache.filters.completed)
                return !cache.filters.invert_filters;
        }
        else if (task.priority === '(_)') {
            if (cache.filters.no_priority)
                return !cache.filters.invert_filters;
        }

        for (let it of cache.filters.priorities) {
            if (it === task.priority)
                return !cache.filters.invert_filters;
        }

        for (let it of cache.filters.contexts) {
            if (task.contexts.indexOf(it) !== -1)
                return !cache.filters.invert_filters;
        }

        for (let it of cache.filters.projects) {
            if (task.projects.indexOf(it) !== -1)
                return !cache.filters.invert_filters;
        }

        for (let it of cache.filters.custom_active) {
            if (FUZZ.fuzzy_search_v1(it, task.task_str) !== null)
                return !cache.filters.invert_filters;
        }

        return cache.filters.invert_filters;
    },

    _has_active_filters: function () {
        if (this.delegate.cache.filters.deferred          ||
            this.delegate.cache.filters.recurring         ||
            this.delegate.cache.filters.hidden            ||
            this.delegate.cache.filters.completed         ||
            this.delegate.cache.filters.no_priority       ||
            this.delegate.cache.filters.priorities.length ||
            this.delegate.cache.filters.contexts.length   ||
            this.delegate.cache.filters.projects.length   ||
            this.delegate.cache.filters.custom_active.length) {

            return true;
        }

        return false;
    },

    on_drag_end: function (task_that_was_dropped) {
        if (this.tasks_viewport.length < 2) return;

        task_that_was_dropped.hide_header_icons();

        let above    = true;
        let relative = task_that_was_dropped.actor.get_next_sibling();

        if (!relative) {
            above    = false;
            relative = task_that_was_dropped.actor.get_previous_sibling();
        }

        for (let arr of [this.tasks_viewport, this.delegate.tasks]) {
            for (let i = 0; i < arr.length; i++) {
                if (arr[i] === task_that_was_dropped) {
                    arr.splice(i, 1);
                    break;
                }
            }

            for (let i = 0; i < arr.length; i++) {
                if (arr[i].actor === relative) {
                    if (above) arr.splice(i, 0, task_that_was_dropped);
                    else       arr.splice(i+1, 0, task_that_was_dropped);
                    break;
                }
            }
        }

        this.delegate.write_tasks_to_file();
    },

    _toggle_filters: function () {
        let filters = this.delegate.cache.filters;

        filters.invert_filters = !filters.invert_filters;
        this.filter_icon.icon_name = filters.invert_filters ?
                                     'timepp-filter-inverted-symbolic' :
                                     'timepp-filter-symbolic';

        this.needs_filtering = true;
        this._add_tasks_to_menu();

        this.delegate.store_cache();
    },

    _toggle_automatic_sort: function () {
        let state = !this.automatic_sort;

        for (let task of this.tasks_viewport) {
            task.dnd.drag_enabled = !state;
        }

        if (state) this.sort_icon.add_style_class_name('active');
        else       this.sort_icon.remove_style_class_name('active');

        this.delegate.get_current_todo_file().automatic_sort = state;
        this.automatic_sort = state;

        this.delegate.store_cache();
        if (state) this.delegate.on_tasks_changed();
    },

    close: function () {
        this._remove_tasks_from_menu();

        for (let task of this.delegate.tasks) {
            task.actor_parent     = null;
            task.actor_scrollview = null;
            task.owner            = null;
        }

        this.tasks_viewport = [];
        this.delegate.disconnect(this.open_state_changed_id);
        this.sigm.clear();
        this.actor.destroy();
    },
});
Signals.addSignalMethods(ViewDefault.prototype);
