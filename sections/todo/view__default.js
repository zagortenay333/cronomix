const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Shell     = imports.gi.Shell;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;

const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SIG_MANAGER = ME.imports.lib.signal_manager;
const MISC_UTILS  = ME.imports.lib.misc_utils;
const FUZZ        = ME.imports.lib.fuzzy_search;
const REG         = ME.imports.lib.regex;
const DND         = ME.imports.lib.dnd;


const G = ME.imports.sections.todo.GLOBAL;



// =====================================================================
// @@@ ViewDefault
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
var ViewDefault = class ViewDefault {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.kanban_string               = "";
        this.kanban_columns              = new Map();
        this.task_with_active_kanban_str = null;

        this.add_tasks_to_menu_mainloop_id = null;
        this.tasks_viewport  = [];
        this.needs_filtering = true;
        this.automatic_sort  = this.delegate.get_current_todo_file().automatic_sort;

        this.has_active_filters = this._has_active_filters();

        this.tasks_added_to_menu = false;

        this.sigm = new SIG_MANAGER.SignalManager();


        //
        // draw
        //
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'view-default view-box' });

        this.dummy_focus_actor = new St.Widget({ visible: false, width: 0, height: 0 });
        this.actor.add_child(this.dummy_focus_actor);

        this.columns_scroll = new St.ScrollView({ vscrollbar_policy: Gtk.PolicyType.NEVER,});
        this.actor.add_actor(this.columns_scroll);

        this.content_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true, style_class: 'view-box-content' });
        this.columns_scroll.add_actor(this.content_box);


        //
        // listen
        //
        this.sigm.connect(this.delegate, 'section-open-state-changed', (_, state) => {
            if (!this.tasks_added_to_menu) this._add_tasks_to_menu();
        });
        this.columns_scroll.connect('scroll-event', (_, event) => this.horiz_scroll(event));
        this.content_box.connect('allocation-changed', () => {
            this.columns_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;
            let [, nat_w] = this.content_box.get_preferred_width(-1);
            let max_w = this.ext.menu_max_w;
            if (nat_w >= max_w) this.columns_scroll.hscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.sigm.connect(this.actor, 'event', (_, event) => {
            switch (event.get_key_symbol()) {
              case Clutter.KEY_slash:
                this.delegate.show_view__search();
                break;
              case Clutter.KEY_f:
                this.delegate.show_view__file_switcher();
                break;
              case Clutter.KEY_i:
                this.delegate.show_view__task_editor();
                break;
              case Clutter.KEY_k:
                this.delegate.show_view__kanban_switcher();
                break;
              case Clutter.KEY_y:
                this.delegate.show_view__filters();
                break;
              case Clutter.KEY_s:
                this.delegate.show_view__sort();
                break;
            }
        });


        //
        // finally
        //
        this._init_columns();
    }

    _init_columns () {
        let w = this.delegate.settings.get_int('todo-task-width') + 20;

        this._clear_kanban_columns();

        let [success, task, str] = this._get_active_kanban_board();

        if (success) {
            this.kanban_string               = str;
            this.task_with_active_kanban_str = task;

            let columns = str.slice(str.indexOf('|')+1).split('|');
            for (let it of columns) {
                let is_collapsed = (it[0] === '_');
                if (is_collapsed) it = it.slice(1);

                let column = new KanbanColumn(this.ext, this.delegate, this, it, is_collapsed);
                column.tasks_scroll_content.style = `width: ${w}px;`;
                this.kanban_columns.set(it, column);
                this.content_box.add_child(column.actor);
            }
        } else {
            let column = new KanbanColumn(this.ext, this.delegate, this, '$', false);
            column.tasks_scroll_content.style = `width: ${w}px;`;
            this.kanban_columns.set('$', column);
            this.content_box.add_child(column.actor);
        }

        if (this.kanban_columns.size === 1) this.delegate.actor.add_style_class_name('one-column');
        if (this.ext.menu.isOpen) this._add_tasks_to_menu();
    }

    _get_active_kanban_board () {
        for (let it of this.delegate.tasks) {
            if (! it.kanban_boards) continue;

            for (let str of it.kanban_boards) {
                if (str[4] === '*') return [true, it, str];
            }
        }

        return [false, null, null];
    }

    _clear_kanban_columns () {
        this._remove_tasks_from_menu();
        for (let [,column] of this.kanban_columns) column.close();
        this.kanban_columns.clear();
    }

    _add_tasks_to_menu () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this.tasks_added_to_menu = true;

        for (let [,column] of this.kanban_columns)
            column.tasks_scroll_content.remove_all_children();

        let arr;

        if (this.needs_filtering) {
            this.tasks_viewport = [];
            arr = this.delegate.tasks;
        } else {
            arr = this.tasks_viewport;
        }

        this._add_tasks_to_menu__finish(0, arr, false);
    }

    _add_tasks_to_menu__finish (i, arr, scrollbar_shown) {
        let n = 50;

        for (let j = 0; j < n; j++, i++) {
            if (i === arr.length) {
                this.needs_filtering = false;
                this.add_tasks_to_menu_mainloop_id = null;
                for (let [,col] of this.kanban_columns) col.set_title();
                Mainloop.idle_add(() => this.update_scrollbars());

                return;
            }

            let it = arr[i];

            if (it.actor_parent) continue;

            let column = this._get_column(it);
            if (! column) continue;

            if (this.needs_filtering) {
                if (!this._filter_test(it)) {
                    n++;
                    continue;
                }
                this.tasks_viewport.push(it);
            }

            column.tasks_scroll_content.add_child(it.actor);

            it.owner            = column;
            it.actor_parent     = column.tasks_scroll_content;
            it.actor_scrollview = [[column.tasks_scroll], [this.columns_scroll]];
            it.dnd.drag_enabled = true;
        }

        this.update_scrollbars();

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
            this._add_tasks_to_menu__finish(i, arr, scrollbar_shown);
        });
    }

    _remove_tasks_from_menu () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        for (let [,column] of this.kanban_columns) {
            column.tasks_scroll_content.remove_all_children();
        }

        for (let task of this.tasks_viewport) {
            task.actor_parent     = null;
            task.actor_scrollview = null;
            task.owner            = null;
        }
    }

    // If we only have one column, then we hide it's vertical scrollbar if it's
    // not needed since the extra space that gets allocated for it is ugly.
    //
    // With multiple columns, we get all sorts of little issues with respect to
    // dnd that require nasty hacks.
    // It's not worth it, so we set the scrollbar to AUTOMATIC.
    update_scrollbars () {
        if (!this.ext.menu.isOpen || this.kanban_columns.size > 1) return;

        for (let [,col] of this.kanban_columns) {
            col.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (this.ext.needs_scrollbar()) col.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        }
    }

    // @task: obj (a task object)
    //
    // A predicate used to determine whether a task inside the this.tasks array
    // will be added to this.tasks_viewport array (i.e., whether it can be
    // visible to the user).
    //
    // If invert_filters is false, return true if at least one filter is matched.
    // If invert_filters is true,  return false if at least one filter is matched.
    _filter_test (task) {
        let filters = this.delegate.get_current_todo_file().filters;

        if (task.pinned)                    return true;
        if (filters.hidden)                 return task.hidden;
        if (task.hidden)                    return false;
        if (filters.deferred)               return task.is_deferred;
        if (filters.recurring)              return Boolean(task.rec_str);
        if (task.rec_str && task.completed) return false;
        if (task.is_deferred)               return false;
        if (! this.has_active_filters)      return true;

        if (task.completed) {
            if (filters.completed)
                return !filters.invert_filters;
        }
        else if (task.priority === '(_)') {
            if (filters.no_priority)
                return !filters.invert_filters;
        }

        for (let it of filters.priorities) {
            if (it === task.priority)
                return !filters.invert_filters;
        }

        for (let it of filters.contexts) {
            if (task.contexts.indexOf(it) !== -1)
                return !filters.invert_filters;
        }

        for (let it of filters.projects) {
            if (task.projects.indexOf(it) !== -1)
                return !filters.invert_filters;
        }

        for (let it of filters.custom_active) {
            if (FUZZ.fuzzy_search_v1(it, task.task_str) !== null)
                return !filters.invert_filters;
        }

        return filters.invert_filters;
    }

    _has_active_filters () {
        let filters = this.delegate.get_current_todo_file().filters;

        if (filters.deferred          ||
            filters.recurring         ||
            filters.hidden            ||
            filters.completed         ||
            filters.no_priority       ||
            filters.priorities.length ||
            filters.contexts.length   ||
            filters.projects.length   ||
            filters.custom_active.length) {

            return true;
        }

        return false;
    }

    _toggle_filters () {
        let filters = this.delegate.get_current_todo_file().filters;

        filters.invert_filters = !filters.invert_filters;
        this.filter_icon.gicon = MISC_UTILS.getIcon(
                                    filters.invert_filters ?
                                    'timepp-filter-inverted-symbolic' :
                                    'timepp-filter-symbolic'
                                )

        this.needs_filtering = true;
        this._add_tasks_to_menu();

        this.delegate.store_cache();
    }

    toggle_automatic_sort () {
        let state = !this.automatic_sort;

        if (state) {
            for (let [,col] of this.kanban_columns)
                col.sort_icon.add_style_class_name('active');
        } else {
            for (let [,col] of this.kanban_columns)
                col.sort_icon.remove_style_class_name('active');
        }

        this.delegate.get_current_todo_file().automatic_sort = state;
        this.automatic_sort = state;

        this.delegate.store_cache();
        if (state) this.delegate.on_tasks_changed(true, true);
    }

    on_drag_end (old_parent, new_parent, column) {
        this.update_kan_string(false);
        this.delegate.on_tasks_changed(true, true);
    }

    update_kan_string (write_to_file = true) {
        let new_kanban_str = this.kanban_string.slice(0, this.kanban_string.indexOf('|'));

        for (let it of this.content_box.get_children()) {
            let col = it._owner;
            if (col.is_collapsed) new_kanban_str += '|_' + col.col_str;
            else                  new_kanban_str += '|' + col.col_str;
        }

        let t = this.task_with_active_kanban_str;
        t.reset(true, t.task_str.replace(this.kanban_string, new_kanban_str));
        this.kanban_string = new_kanban_str;

        if (write_to_file) this.delegate.write_tasks_to_file();
    }

    _get_column (task) {
        for (let [name, column] of this.kanban_columns) {
            if (column.is_kitchen_sink) return column;

            for (let it of column.filters) {
                if (task.projects.indexOf(it) !== -1 || task.contexts.indexOf(it) !== -1 || task.priority === it) {
                    return column;
                }
            }
        }

        return null;
    }

    horiz_scroll (event) {
        let direction = event.get_scroll_direction();
        let delta = 0;

        if      (direction === Clutter.ScrollDirection.UP)   delta = -1;
        else if (direction === Clutter.ScrollDirection.DOWN) delta = 1;
        else return Clutter.EVENT_PROPAGATE;

        let bar = this.columns_scroll.get_hscroll_bar();

        if (! bar) return;

        let a = bar.get_adjustment();
        a.value += delta * a.stepIncrement;
    }

    close () {
        this.sigm.clear();
        this._clear_kanban_columns();
        this.actor.destroy();
        this.actor = null;
    }
}
Signals.addSignalMethods(ViewDefault.prototype);



// =====================================================================
// @@@ KanbanColumn
//
// @ext          : obj (main extension object)
// @delegate     : obj (main section object)
// @owner        : obj (@@@ ViewDefault)
// @col_str      : string
// @is_collapsed : bool
// =====================================================================
var KanbanColumn = class KanbanColumn {
    constructor (ext, delegate, owner, col_str, is_collapsed) {
        this.ext          = ext;
        this.delegate     = delegate;
        this.owner        = owner;
        this.col_str      = col_str;
        this.is_collapsed = is_collapsed;

        this.actor_scrollview = [[], [this.owner.columns_scroll]];
        this.actor_parent     = this.owner.content_box;

        this.filters = this.col_str.split(',');

        this.is_kitchen_sink = true;
        this.title_visible   = false;

        for (let it of this.filters) {
            if (it && it !== '$') this.title_visible = true;

            if (REG.TODO_CONTEXT.test(it) || REG.TODO_PROJ.test(it) || it === '(_)' || REG.TODO_PRIO.test(it)) {
                this.is_kitchen_sink = false;
                break;
            }
        }


        this.sigm = new SIG_MANAGER.SignalManager();
        this.rotate_id = null;


        //
        // draw
        //
        this.actor  = new St.BoxLayout({ vertical: true, y_expand: true, x_expand: false, style_class: 'kanban-column' });
        this.actor._owner = this; // can't use _delegate here due to dnd !!!

        this.content_box = new St.BoxLayout({ vertical: true, y_expand: true });
        this.actor.add_child(this.content_box);
        this.content_box._delegate = this;


        //
        // header
        //
        this.header_wrapper = new St.Widget({ style_class: 'timepp-menu-item header', layout_manager: new Clutter.BoxLayout(), });
        this.content_box.add_child(this.header_wrapper);
        this.header = new St.BoxLayout({ reactive: true, x_expand: true });
        this.header_wrapper.add_child(this.header);


        //
        // kanban column title
        //
        this.kanban_title = new St.Label({ visible: this.title_visible, reactive: true, can_focus: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this.header.add_child(this.kanban_title);


        //
        // the functional part of the header (add task, ...)
        //
        this.header_fn_btns = new St.BoxLayout({ visible: !this.title_visible, x_expand: true });
        this.header.add_child(this.header_fn_btns);

        this.add_task_button = new St.Button({ can_focus: true, x_align: St.Align.START, style_class: 'add-task' });
        this.header_fn_btns.add(this.add_task_button, { expand: true });

        this.add_task_bin = new St.BoxLayout();
        this.add_task_button.add_actor(this.add_task_bin);

        this.add_task_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-plus-symbolic'), y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_icon);

        this.add_task_label = new St.Label({ text: _('Add New Task...'), y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_label);


        //
        // header icons
        //
        this.icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header_fn_btns.add_child(this.icon_box);

        this.collapse_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-column-collapse-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'collapse-icon' });
        this.icon_box.add_child(this.collapse_icon);

        this.kanban_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-kanban-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'kanban-icon' });
        this.icon_box.add_child(this.kanban_icon);

        this.clear_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-clear-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'clear-icon' });
        this.icon_box.add_child(this.clear_icon);
        this.clear_icon.visible = this.delegate.stats.completed > 0;

        this.filter_icon = new St.Icon({ can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'filter-icon' });
        this.icon_box.add_child(this.filter_icon);

        if (this.owner.has_active_filters) this.filter_icon.add_style_class_name('active');
        else                               this.filter_icon.remove_style_class_name('active');

        if (this.delegate.get_current_todo_file().filters.invert_filters)
            this.filter_icon.gicon = MISC_UTILS.getIcon('timepp-filter-inverted-symbolic');
        else
            this.filter_icon.gicon = MISC_UTILS.getIcon('timepp-filter-symbolic');

        this.sort_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-sort-ascending-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'sort-icon' });
        this.icon_box.add_child(this.sort_icon);
        if (this.owner.automatic_sort) this.sort_icon.add_style_class_name('active');
        else                           this.sort_icon.remove_style_class_name('active');

        this.search_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-search-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'search-icon' });
        this.icon_box.add_child(this.search_icon);

        this.file_switcher_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-file-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'file-switcher-icon' });
        this.icon_box.add_child(this.file_switcher_icon);

        this.stats_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-graph-symbolic'), can_focus: true, reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'stats-icon' });
        this.icon_box.add_child(this.stats_icon);


        //
        // task items box
        //
        this.tasks_scroll = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, style_class: 'timepp-menu-item tasks-container', y_align: St.Align.START});
        this.content_box.add_child(this.tasks_scroll);

        if (this.owner.kanban_columns.size > 1) this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.AUTOMATIC;

        this.tasks_scroll_content = new St.BoxLayout({ vertical: true, style_class: 'tasks-content-box'});
        this.tasks_scroll.add_actor(this.tasks_scroll_content);


        //
        // DND
        //
        // @HACK
        // The task items are draggable and their container is also draggable.
        // Gnome's dnd module propagates button-press-event and touch-event to
        // the container when a task item is dragged which will result in
        // dragging the container at the same time the task item is dragged.
        // To prevent this, we also connect on those events and only react if
        // the source was an actor that we whitelist (e.g., the tasks_scroll.)
        //
        // NOTE: We must connect on these before instantiating our dnd module.
        this.actor.connect('button-press-event', (_, event) => this._on_maybe_drag(event));
        this.actor.connect('touch-event', (_, event) => this._on_maybe_drag(event));

        this.dnd = new DND.Draggable(this, G.DNDGroup.KANBAN_COLUMN, false);


        //
        // listen
        //
        this.sigm.connect(this.delegate.settings, 'changed::todo-task-width', () => {
            let width = this.delegate.settings.get_int('todo-task-width');
            this.tasks_scroll_content.style = `width: ${width}px;`;
        });
        this.sigm.connect(this.delegate.settings, 'changed::todo-task-width', () => {
            this.header.set_width(this.delegate.settings.get_int('todo-task-width'));
        });
        this.sigm.connect(this.tasks_scroll, 'scroll-event', (_, event) => {
            if (event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                this.owner.horiz_scroll(event);
                return Clutter.EVENT_STOP;
            }
        });
        this.sigm.connect(this.header_fn_btns, 'event', (_, event) => {
            if (! this.title_visible) return;

            Mainloop.timeout_add(0, () => {
                if (!this.header_fn_btns.contains(global.stage.get_key_focus())) {
                    this.kanban_title.show();
                    this.header_fn_btns.hide();
                }
            });
        });
        this.sigm.connect(this.kanban_title, 'key-focus-in', () => {
            Mainloop.idle_add(() => {
                if (global.stage.get_key_focus() === this.kanban_title) this._hide_title();
            });
        });
        this.sigm.connect(this.header, 'leave-event', (_, event) => this._maybe_show_title(event));
        this.sigm.connect(this.header, 'enter-event', () => this._hide_title());
        this.sigm.connect(this.ext, 'custom-css-changed', () => this.set_title());
        this.sigm.connect_release(this.add_task_button, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__task_editor());
        this.sigm.connect_release(this.collapse_icon, Clutter.BUTTON_PRIMARY, true, () => this.toggle_collapse());
        this.sigm.connect_release(this.kanban_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__kanban_switcher());
        this.sigm.connect_release(this.filter_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__filters());
        this.sigm.connect_on_button(this.filter_icon, Clutter.BUTTON_MIDDLE, () => this._toggle_filters());
        this.sigm.connect_release(this.file_switcher_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__file_switcher());
        this.sigm.connect_release(this.search_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__search());
        this.sigm.connect_release(this.stats_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__time_tracker_stats());
        this.sigm.connect_release(this.clear_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__clear_completed());
        this.sigm.connect_release(this.sort_icon, Clutter.BUTTON_PRIMARY, true, () => this.delegate.show_view__sort());
        this.sigm.connect_on_button(this.sort_icon, Clutter.BUTTON_MIDDLE, () => this.owner.toggle_automatic_sort());


        //
        // finally
        //
        if (is_collapsed) {
            this.is_collapsed = false;
            this.collapse(false);
        }
    }

    toggle_collapse () {
        if (this.is_collapsed) this.uncollapse();
        else                   this.collapse();
    }

    collapse (update_kan_string = true) {
        if (this.is_collapsed) return;
        this.is_collapsed = true;

        this.tasks_scroll.hide();
        this.collapse_icon.gicon = MISC_UTILS.getIcon('timepp-column-uncollapse-symbolic');
        this.actor.add_style_class_name('collapsed');
        this.icon_box.remove_child(this.collapse_icon);
        this.header.insert_child_at_index(this.collapse_icon, 0);

        // Don't like the way we rotate the text, but it's the only thing I
        // could come up with..
        // We switch the layout manager of the header_wrapper in addition to
        // rotating the header.
        this.header.set_pivot_point(0, 1);
        this.header.rotation_angle_z = 90;
        this.header_wrapper.set_layout_manager(new Clutter.FixedLayout());
        this.rotate_id = this.header.connect('allocation-changed', () => {
            this.header_wrapper.set_width(this.header.get_height());
            this.header.set_width(Math.floor(this.actor.get_height() * 0.9));
            this.header.disconnect(this.rotate_id);
            this.rotate_id = null;
        });

        if (update_kan_string) this.owner.update_kan_string();
    }

    uncollapse () {
        if (! this.is_collapsed) return;
        this.is_collapsed = false;

        if (this.rotate_id) {
            this.header.disconnect(this.rotate_id);
            this.rotate_id = null;
        }

        this.tasks_scroll.show();
        this.actor.set_height(-1);
        this.header.set_width(-1);
        this.header_wrapper.set_width(-1);
        this.collapse_icon.gicon = MISC_UTILS.getIcon('timepp-column-collapse-symbolic');
        this.actor.remove_style_class_name('collapsed');
        this.header.remove_child(this.collapse_icon);
        this.icon_box.insert_child_at_index(this.collapse_icon, 0);

        this.header_wrapper.set_layout_manager(new Clutter.BoxLayout());
        this.header.rotation_angle_z = 0;

        this.owner.update_kan_string();
    }

    set_title () {
        let markup = `<b>${this.tasks_scroll_content.get_n_children()}</b>   `;

        for (let i = 0; i < this.filters.length; i++) {
            let it = this.filters[i];

            if (REG.TODO_CONTEXT.test(it)) {
                let c = this.ext.custom_css['-timepp-context-color'][0];
                markup += `<span foreground="${c}"><b>${it}</b></span>  `;
            }
            else if (REG.TODO_PROJ.test(it)) {
                let c = this.ext.custom_css['-timepp-project-color'][0];
                markup += `<span foreground="${c}"><b>${it}</b></span>  `;
            }
            else {
                markup += `<b>${it}</b>  `;
            }
        }

        this.kanban_title.clutter_text.set_markup(markup.replace(/\\ /g, ' '));
    }

    _maybe_show_title (event) {
        if (! this.title_visible) return;

        let related = event.get_related();
        if (related && !this.header_fn_btns.contains(related)) {
            this.header_fn_btns.hide();
            this.kanban_title.show();
            this.delegate.panel_item.actor.grab_key_focus();
        }
    }

    _hide_title () {
        if (this.is_collapsed) return;
        this.kanban_title.hide();
        this.header_fn_btns.show();
        if (this.title_visible) this.header_fn_btns.get_first_child().grab_key_focus();
    }

    _on_maybe_drag (event) {
        if (this.owner.kanban_columns.size < 2) return Clutter.EVENT_STOP;

        switch (event.get_source()) {
          case this.actor:
          case this.header:
          case this.tasks_scroll:
            return Clutter.EVENT_PROPAGATE;
          default:
            return Clutter.EVENT_STOP;
        }
    }

    // A task got dropped
    on_drag_end (old_parent, new_parent, task) {
        task.hide_header_icons();

        if (old_parent === new_parent) {
            if (this.delegate.get_current_todo_file().automatic_sort) {
                this._sort_task_in_column(new_parent, task);
            } else {
                this._sort_task_in_arrays(task);
                this.delegate.write_tasks_to_file();
            }

            return;
        }

        let [old_col, target_col, destination_column] = this._update_task_props(old_parent, new_parent, task);

        if (target_col !== destination_column) {
            task.actor_parent.remove_child(task.actor);
            destination_column.tasks_scroll_content.add_child(task.actor);
            task.actor_parent = destination_column.tasks_scroll_content;
        }

        task.owner            = destination_column;
        task.actor_parent     = destination_column.tasks_scroll_content;
        task.actor_scrollview = [[destination_column.tasks_scroll], [this.owner.columns_scroll]];

        this.delegate.on_tasks_changed();

        old_col.set_title();
        destination_column.set_title();

        if (this.delegate.get_current_todo_file().automatic_sort)
            this._sort_task_in_column(task.actor_parent, task);
    }

    // We don't want to refresh the entire view after the tasks have been
    // sorted; we only need to put the dragged task in the right position.
    _sort_task_in_column (container, task) {
        let tasks  = this.delegate.tasks;
        let idx    = tasks.indexOf(task);
        let sorted = false;

        for (let i = idx+1; i < tasks.length; i++) {
            let it = tasks[i].actor;

            if (container.contains(it)) {
                container.set_child_below_sibling(task.actor, it);
                sorted = true;
                break;
            }
        }

        if (! sorted) {
            container.remove_child(task.actor);
            container.add_child(task.actor);
        }
    }

    _sort_task_in_arrays (task) {
        if (this.tasks_scroll_content.get_n_children() < 2) return;

        let above    = true;
        let relative = task.actor.get_next_sibling();

        if (! relative) {
            above    = false;
            relative = task.actor.get_previous_sibling();
        }

        for (let arr of [this.owner.tasks_viewport, this.delegate.tasks]) {
            for (let i = 0; i < arr.length; i++) {
                if (arr[i] === task) {
                    arr.splice(i, 1);
                    break;
                }
            }

            for (let i = 0; i < arr.length; i++) {
                if (arr[i].actor === relative) {
                    if (above) arr.splice(i, 0, task);
                    else       arr.splice(i+1, 0, task);
                    break;
                }
            }
        }
    }

    // When the user drags a task from one column to another:
    //   - remove all properties in the task (priority, context, proj) that
    //     would make the task go into any column between the old and new.
    //   - ensure that the task has the property that will make it go into
    //     the new column.
    //
    // In some cases it is not possible to ensure that the task will not be put
    // into a column that the user didn't drag it into.
    // E.g.,
    //   - User dragged from col1 to col3 but col2 is a kitchen sink.
    //   - User dragged from col1 (a priority column) into col3 not a priority
    //     column but col2 is (_). When we remove priority (A) from the task, it
    //     will end up in col2.
    //
    // For this reason, we return [@old_col, @new_col, @destination_column]
    //   @old_col            : column in which the task used to be in
    //   @new_col            : column into which the user dropped the task
    //   @destination_column : column in which the task ended up
    _update_task_props (old_parent, new_parent, task) {
        let old_col, new_col, idx_old, idx_new;

        let children = this.owner.content_box.get_children();
        for (let i = 0; i < children.length; i++) {
            let it = children[i]._owner;

            if (it.tasks_scroll_content === old_parent) {
                old_col = it;
                idx_old = i;
            } else if (it.tasks_scroll_content === new_parent) {
                new_col = it;
                idx_new = i;
            }
        }

        let new_task_str = task.task_str;

        // ensure new prop
        if (! new_col.is_kitchen_sink) {
            let prop = new_col.filters[0];

            if (REG.TODO_CONTEXT.test(prop) && task.contexts.indexOf(prop) === -1) {
                new_task_str = new_task_str + ' ' + prop;
            }
            else if (REG.TODO_PROJ.test(prop) && task.projects.indexOf(prop) === -1) {
                new_task_str = new_task_str + ' ' + prop;
            }
            else if (prop === '(_)' || REG.TODO_PRIO.test(prop)) {
                task.priority = prop;
                new_task_str  = task.new_str_for_prio(prop);
            }
        }

        // remove old props
        let kitchen_sink_col = [null, -1];
        let no_prio_col      = [null, -1];

        let ltr              = idx_old < idx_new;

        let [i, len] = ltr ? [idx_old, idx_new] : [idx_new, idx_old];

        for (; i <= len; i++) {
            let it = this.owner.content_box.get_child_at_index(i)._owner;

            if (it === new_col) continue;

            if (it.is_kitchen_sink) {
                if (!kitchen_sink_col[0] && ltr) kitchen_sink_col = [it, i];
                continue;
            }

            for (let f of it.filters) {
                if (REG.TODO_CONTEXT.test(f) && task.contexts.indexOf(f) !== -1) {
                    new_task_str = new_task_str.replace(new RegExp(`(^| )\\${f}`, 'g'), '');
                }
                else if (REG.TODO_PROJ.test(f) && task.projects.indexOf(f) !== -1) {
                    new_task_str = new_task_str.replace(new RegExp(`(^| )\\${f}`, 'g'), '');
                }
                else if (REG.TODO_PRIO.test(f) && task.priority === f) {
                    new_task_str = task.new_str_for_prio('(_)', new_task_str);
                }
                else if (f === '(_)' && ltr && !no_prio_col[0]) {
                    no_prio_col = [it, i];
                }
            }
        }

        task.reset(true, new_task_str.trim());

        if (task.priority !== '(_)') no_prio_col = [null, -1];

        let destination_column;

        let i1 = kitchen_sink_col[1];
        let i2 = no_prio_col[1];

        if      (i1 === i2) destination_column = new_col;
        else if (i1 < 0)    destination_column = no_prio_col[0];
        else if (i2 < 0)    destination_column = kitchen_sink_col[0];
        else if (i1 < i2)   destination_column = kitchen_sink_col[0];
        else                destination_column = no_prio_col[0];

        return [old_col, new_col, destination_column];
    }

    handleDragOver (source, drag_actor, x, y, time) {
        if (source.dnd_group !== G.DNDGroup.TASK) return DND.DragMotionResult.CONTINUE;
        if (source.item.actor_parent === this.tasks_scroll_content) return DND.DragMotionResult.CONTINUE;

        source.item.actor_parent.remove_child(source.item.actor);
        source.item.actor_parent = this.tasks_scroll_content;
        this.tasks_scroll_content.add_child(source.item.actor);

        return DND.DragMotionResult.MOVE_DROP;
    }

    close () {
        this.sigm.clear();
    }
}
Signals.addSignalMethods(KanbanColumn.prototype);
