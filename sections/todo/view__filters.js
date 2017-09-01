const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const CheckBox  = imports.ui.checkBox;
const PopupMenu = imports.ui.popupMenu;
const Lang      = imports.lang;
const Signals   = imports.signals;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MULTIL_ENTRY   = ME.imports.lib.multiline_entry;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ Filter UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//  - 'filters-updated' returns obj with which to replace the cache.filters obj
// =====================================================================
const TaskFiltersWindow = new Lang.Class({
    Name: 'Timepp.TaskFiltersWindow',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        // We store all filter item objects here.
        // I.e., those objects created by the _new_filter_item() func.
        this.filter_register = {
            completed   : null,
            no_priority : null,
            priorities  : [],
            contexts    : [],
            projects    : [],
            custom      : [],
        };


        //
        // actor
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box filter-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // filters
        //
        this.filter_sectors_scroll = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.filter_sectors_scroll);

        this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.filter_sectors_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.filter_sectors_scroll_box = new St.BoxLayout({ vertical: true });
        this.filter_sectors_scroll.add_actor(this.filter_sectors_scroll_box);

        this.custom_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.custom_filters_box);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Add custom filter...'), false, true);
        this.custom_filters_box.add_child(this.entry.actor);

        this.priority_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.priority_filters_box);

        this.context_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.context_filters_box);

        this.project_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.project_filters_box);


        this._add_separator(this.content_box);


        //
        // show hidden only switch
        //
        this.show_hidden_tasks_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.show_hidden_tasks_item);

        let show_hidden_tasks_label = new St.Label({ text: _('Show only hidden tasks'), y_align: Clutter.ActorAlign.CENTER });
        this.show_hidden_tasks_item.add(show_hidden_tasks_label, {expand: true});

        let hidden_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_hidden_tasks_item.add_child(hidden_count_label);

        hidden_count_label.text = ngettext(
                '%d hidden task',
                '%d hidden tasks',
                this.delegate.stats.hidden).format(this.delegate.stats.hidden);

        this.show_hidden_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_hidden_tasks_item.add_actor(this.show_hidden_tasks_toggle_btn);
        this.show_hidden_tasks_toggle = new PopupMenu.Switch();
        this.show_hidden_tasks_toggle_btn.add_actor(this.show_hidden_tasks_toggle.actor);


        //
        // show recurring only switch
        //
        this.show_recurring_tasks_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.show_recurring_tasks_item);

        let show_recurring_tasks_label = new St.Label({ text: _('Show only recurring tasks'), y_align: Clutter.ActorAlign.CENTER });
        this.show_recurring_tasks_item.add(show_recurring_tasks_label, {expand: true});

        let recurring_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_recurring_tasks_item.add_child(recurring_count_label);

        let n_recurring = this.delegate.stats.recurring_completed +
                          this.delegate.stats.recurring_incompleted;

        recurring_count_label.text =
            ngettext('%d recurring task', '%d recurring tasks', n_recurring)
            .format(n_recurring);

        this.show_recurring_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_recurring_tasks_item.add_actor(this.show_recurring_tasks_toggle_btn);
        this.show_recurring_tasks_toggle = new PopupMenu.Switch();
        this.show_recurring_tasks_toggle_btn.add_actor(this.show_recurring_tasks_toggle.actor);


        //
        // Invert switch (whitelist/blacklist)
        //
        this.invert_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.invert_item);

        let invert_label = new St.Label({ text: _('Invert filters'), y_align: St.Align.END });
        this.invert_item.add(invert_label, {expand: true});

        this.invert_toggle_btn = new St.Button({ can_focus: true });
        this.invert_item.add_actor(this.invert_toggle_btn);
        this.invert_toggle = new PopupMenu.Switch();
        this.invert_toggle_btn.add_actor(this.invert_toggle.actor);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);

        this.button_reset = new St.Button({ can_focus: true, label: _('Reset'), style_class: 'button' });
        this.button_ok    = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button' });

        this.btn_box.add(this.button_reset, {expand: true});
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // load filter items
        //
        this._load_filters();


        //
        // listen
        //
        this.entry.entry.clutter_text.connect('key-focus-in', () => {
            SCROLL_TO_ITEM.scroll(this.filter_sectors_scroll,
                                  this.filter_sectors_scroll_box,
                                  this.custom_filters_box);
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (! this.entry.entry.get_text()) return;

            // check for duplicates
            for (let i = 0; i < this.filter_register.custom.length; i++) {
                if (this.filter_register.custom[i].filter === this.entry.entry.get_text())
                    return;
            }

            let item = this._new_filter_item(true, this.entry.entry.get_text(), false,
                                             true, this.custom_filters_box);
            this.custom_filters_box.add_child(item.actor);
            this.filter_register.custom.push(item);
            this.entry.entry.text = '';
        });
        this.show_hidden_tasks_toggle_btn.connect('clicked', () => {
            this.show_hidden_tasks_toggle.toggle();
            if (this.show_hidden_tasks_toggle.state)
                this.show_recurring_tasks_toggle.setToggleState(false);
        });
        this.show_recurring_tasks_toggle_btn.connect('clicked', () => {
            this.show_recurring_tasks_toggle.toggle();
            if (this.show_recurring_tasks_toggle.state)
                this.show_hidden_tasks_toggle.setToggleState(false);
        });
        this.invert_toggle_btn.connect('clicked', () => {
            this.invert_toggle.toggle();
        });
        this.button_reset.connect('clicked', () => {
            this._reset_all();
        });
        this.button_ok.connect('clicked', () => {
            this._on_ok_clicked();
        });
        this.filter_sectors_scroll_box.connect('queue-redraw', () => {
            this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (this.ext.needs_scrollbar())
                this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    _load_filters: function () {
        let filters = this.delegate.cache.filters;

        this.invert_toggle.setToggleState(filters.invert_filters);
        this.show_hidden_tasks_toggle.setToggleState(filters.hidden);
        this.show_recurring_tasks_toggle.setToggleState(filters.recurring);


        let i, len, key, value, item, check;


        //
        // custom filters
        //
        len = filters.custom.length;
        for (i = 0; i < len; i++) {
            value = filters.custom[i];
            check = filters.custom_active.indexOf(value) === -1 ? false : true;
            item  = this._new_filter_item(check, value, 0, true, this.custom_filters_box);
            this.custom_filters_box.add_child(item.actor);
            this.filter_register.custom.push(item);
        }


        this._add_separator(this.priority_filters_box);


        //
        // completed
        //
        if (this.delegate.stats.completed > 0) {
            item = this._new_filter_item(filters.completed, _('Completed'),
                this.delegate.stats.completed, 0, this.priority_filters_box);
            this.filter_register.completed = item;
            this.priority_filters_box.add_child(item.actor);
        }


        //
        // no priority
        //
        if (this.delegate.stats.no_priority > 0) {
            item = this._new_filter_item(filters.no_priority, _('No Priority'),
                this.delegate.stats.no_priority, 0, this.priority_filters_box);
            this.filter_register.no_priority = item;
            this.priority_filters_box.add_child(item.actor);
        }


        //
        // priorities
        //
        for ([key, value] of this.delegate.stats.priorities.entries()) {
            check = filters.priorities.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.priority_filters_box);
            this.filter_register.priorities.push(item);
        }

        this.filter_register.priorities.sort((a, b) => {
            return +(a.filter > b.filter) || +(a.filter === b.filter) - 1;
        });

        for (i = 0; i < this.filter_register.priorities.length; i++) {
            this.priority_filters_box.add_child(this.filter_register.priorities[i].actor);
        }


        this._add_separator(this.context_filters_box);


        //
        // contexts
        //
        for ([key, value] of this.delegate.stats.contexts.entries()) {
            check = filters.contexts.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.context_filters_box);
            this.context_filters_box.add_child(item.actor);
            this.filter_register.contexts.push(item);
        }


        this._add_separator(this.project_filters_box);


        //
        // projects
        //
        for ([key, value] of this.delegate.stats.projects.entries()) {
            check = filters.projects.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.project_filters_box);
            this.project_filters_box.add_child(item.actor);
            this.filter_register.projects.push(item);
        }


        //
        // hide the sections that don't have any items
        //
        [
            this.priority_filters_box,
            this.context_filters_box,
            this.project_filters_box,
        ].forEach((it) => it.get_n_children() === 1 && it.hide());
    },

    _reset_all: function () {
        if (this.filter_register.completed)
            this.filter_register.completed.checkbox.actor.checked = false;

        if (this.filter_register.no_priority)
            this.filter_register.no_priority.checkbox.actor.checked = false;

        [
            this.filter_register.priorities,
            this.filter_register.contexts,
            this.filter_register.projects,
            this.filter_register.custom,
        ].forEach((arr) => {
            for (let i = 0; i < arr.length; i++) {
                arr[i].checkbox.actor.checked = false;
            }
        });
    },

    _new_filter_item: function (is_checked, label, count, is_deletable, parent_box) {
        let item = {};

        item.actor = new St.BoxLayout({ reactive: true, style_class: 'filter-window-item' });

        item.filter = label;

        item.label = new St.Label({ text: label, y_align: Clutter.ActorAlign.CENTER });
        item.actor.add(item.label, {expand: true});

        if (count) {
            item.count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
            item.actor.add_child(item.count_label);
            item.count_label.text =
                ngettext('%d task', '%d tasks', count).format(count) + '   ';
        }

        item.checkbox = new CheckBox.CheckBox();
        item.actor.add_actor(item.checkbox.actor);
        item.checkbox.actor.checked = is_checked;


        let close_button;

        if (is_deletable) {
            close_button = new St.Button({ can_focus: true, style_class: 'close-icon' });
            item.actor.add_actor(close_button);

            let close_icon = new St.Icon({ icon_name: 'timepp-close-symbolic' });
            close_button.add_actor(close_icon);

            close_button.connect('clicked', () => {
                this._delete_custom_item(item);
            });
        }

        let actor_to_connect = is_deletable ? close_button : item.checkbox.actor;

        actor_to_connect.connect('key-focus-in', () => {
            SCROLL_TO_ITEM.scroll(this.filter_sectors_scroll,
                                  this.filter_sectors_scroll_box,
                                  parent_box);
        });

        return item;
    },

    _delete_custom_item: function (item) {
        if (item.checkbox.actor.has_key_focus || close_button.has_key_focus)
            this.entry.entry.grab_key_focus();

        item.actor.destroy();

        for (let i = 0; i < this.filter_register.custom.length; i++) {
            if (this.filter_register.custom[i] === item) {
                this.filter_register.custom.splice(i, 1);
                return;
            }
        }
    },

    _add_separator: function (container) {
        let sep = new PopupMenu.PopupSeparatorMenuItem();
        sep.actor.add_style_class_name('timepp-separator');
        container.add_child(sep.actor);
    },

    _on_ok_clicked: function () {
        let filters = {
            invert_filters : this.invert_toggle.state,
            recurring      : this.show_recurring_tasks_toggle.state,
            hidden         : this.show_hidden_tasks_toggle.state,

            completed      : Boolean(this.filter_register.completed &&
                         this.filter_register.completed.checkbox.actor.checked),

            no_priority    : Boolean(this.filter_register.no_priority &&
                       this.filter_register.no_priority.checkbox.actor.checked),

            priorities     : [],
            contexts       : [],
            projects       : [],
            custom         : [],
            custom_active  : [],
        };

        for (let i = 0; i < this.filter_register.priorities.length; i++) {
            let it = this.filter_register.priorities[i];
            if (it.checkbox.actor.checked) filters.priorities.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.contexts.length; i++) {
            let it = this.filter_register.contexts[i];
            if (it.checkbox.actor.checked) filters.contexts.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.projects.length; i++) {
            let it = this.filter_register.projects[i];
            if (it.checkbox.actor.checked) filters.projects.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.custom.length; i++) {
            let it = this.filter_register.custom[i];
            if (it.checkbox.actor.checked) filters.custom_active.push(it.filter);
            filters.custom.push(it.filter);
        }

        this.emit('filters-updated', filters);
    },
});
Signals.addSignalMethods(TaskFiltersWindow.prototype);

