const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;

const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MISC_UTILS = ME.imports.lib.misc_utils;
const FUZZ       = ME.imports.lib.fuzzy_search;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewSearch
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
// =====================================================================
var ViewSearch = class ViewSearch {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.add_tasks_to_menu_mainloop_id = null;

        this.tasks_viewport = [];
        this.current_file = this.delegate.get_current_todo_file();

        // @key : string (a search query)
        // @val : array  (of tasks that match the search query)
        this.search_dict = new Map();


        //
        // container
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-search view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // search entry
        //
        {
            let box = new St.BoxLayout({ style_class: 'timepp-menu-item' });
            this.content_box.add_child(box);

            this.search_entry = new St.Entry({ style: `width: ${delegate.settings.get_int('todo-task-width') + 30}px;`, x_expand: true, can_focus: true });
            box.add_child(this.search_entry);

            box = new St.BoxLayout({ style_class: 'icon-box' });
            this.search_entry.set_secondary_icon(box);

            this.add_filter_icon = new St.Icon({ visible: false, track_hover: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-filter-add-symbolic') });
            box.add_child(this.add_filter_icon);

            this.search_close_icon = new St.Icon({ track_hover: true, reactive: true, style_class: 'close-icon', gicon : MISC_UTILS.getIcon('timepp-close-symbolic') });
            box.add_child(this.search_close_icon);
        }


        //
        // task items box
        //
        this.tasks_scroll = new St.ScrollView({ style_class: 'timepp-menu-item tasks-container vfade search-results', x_fill: true, y_align: St.Align.START});
        this.content_box.add(this.tasks_scroll, {expand: true});
        this.tasks_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.tasks_scroll_content = new St.BoxLayout({ vertical: true, style_class: 'tasks-content-box'});
        this.tasks_scroll.add_actor(this.tasks_scroll_content);


        //
        // listen
        //
        this.search_entry.clutter_text.connect('text-changed', () => this._search());
        this.search_close_icon.connect('button-release-event', () => this.delegate.show_view__default());
        this.add_filter_icon.connect('button-release-event', () => this._add_custom_filter());


        //
        // finally
        //
        this._search();
    }

    _search () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this._remove_tasks_from_menu();

        let needle = this.search_entry.get_text().trim().toLowerCase();

        if (needle === '') {
            this.tasks_viewport = this.delegate.tasks;
            this.add_filter_icon.visible = false;
            this._add_tasks_to_menu();
            return;
        }

        this.add_filter_icon.visible = this.current_file.filters.custom.indexOf(this.search_entry.get_text()) === -1;

        let [search_needed, search_space] = this._find_prev_search_results(needle);

        if (! search_needed) {
            this.tasks_viewport = search_space;
            this._add_tasks_to_menu();
            return;
        }

        let reduced_results = [];

        for (let i = 0, len = search_space.length; i < len; i++) {
            let score = FUZZ.fuzzy_search_v1(needle, search_space[i].task_str.toLowerCase());
            if (score !== null) reduced_results.push([i, score]);
        }

        reduced_results.sort((a, b) => b[1] - a[1]);

        this.tasks_viewport = new Array(reduced_results.length);

        for (let i = 0; i < reduced_results.length; i++) {
            this.tasks_viewport[i] = search_space[ reduced_results[i][0] ];
        }

        this.search_dict.set(needle, this.tasks_viewport);
        this._add_tasks_to_menu();
    }

    _find_prev_search_results (pattern) {
        let res = '';

        for (let [old_patt,] of this.search_dict) {
            if (pattern.startsWith(old_patt) && old_patt.length > res.length)
                res = old_patt;
        }

        if (pattern === res) return [false, this.search_dict.get(res)];
        else if (res)        return [true,  this.search_dict.get(res)];
        else                 return [true,  this.delegate.tasks];
    }

    _add_tasks_to_menu () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;

        this.add_tasks_to_menu_mainloop_id = Mainloop.timeout_add(0, () => {
           this._add_tasks_to_menu__finish(0, false);
        });
    }

    _add_tasks_to_menu__finish (i, scrollbar_shown) {
        if (!scrollbar_shown && this.ext.needs_scrollbar()) {
            this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            scrollbar_shown = true;
        }

        for (let j = 0; j < 8; j++, i++) {
            if (i === this.tasks_viewport.length) {
                this.add_tasks_to_menu_mainloop_id = null;
                if (!scrollbar_shown && this.ext.needs_scrollbar())
                    this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;

                return;
            }

            let it = this.tasks_viewport[i];
            this.tasks_scroll_content.add_child(it.actor);

            it.dnd.drag_enabled = false;
            it.actor_parent     = this.tasks_scroll_content;
            it.actor_scrollview = [[this.tasks_scroll], []];
        }

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
            this._add_tasks_to_menu__finish(i, scrollbar_shown);
        });
    }

    _remove_tasks_from_menu () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        for (let it of this.tasks_viewport) {
            it.actor_parent     = null;
            it.actor_scrollview = null;
        }

        this.tasks_scroll_content.remove_all_children();
        this.tasks_viewport = [];
    }

    _add_custom_filter () {
        let needle  = this.search_entry.get_text();
        let filters = this.delegate.get_current_todo_file().filters;

        if (filters.custom.indexOf(needle) !== -1) return;

        filters.custom.push(needle);
        filters.custom_active.push(needle);
        this.delegate.store_cache();
        this.delegate.show_view__default();
    }

    close () {
        this.search_dict.clear();
        this._remove_tasks_from_menu();
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewSearch.prototype);
