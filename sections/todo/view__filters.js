const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const CheckBox  = imports.ui.checkBox;
const PopupMenu = imports.ui.popupMenu;

const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MULTIL_ENTRY = ME.imports.lib.multiline_entry;
const MISC_UTILS   = ME.imports.lib.misc_utils;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewFilters
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//  - 'filters-updated' returns new filters record
// =====================================================================
var ViewFilters = class ViewFilters {
    constructor (ext, delegate) {
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


        // Array of PopupMenu.Switch() actors
        this.nand_toggles = [];


        //
        // actor
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-filters view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // custom filters entry
        //
        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Add custom filter...'), false, true);
        this.content_box.add_child(this.entry.actor);
        this.entry.actor.add_style_class_name('row');


        //
        // filters
        //
        this.filter_sectors_scroll = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.filter_sectors_scroll);
        this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.filter_sectors_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.filter_sectors_scroll_box = new St.BoxLayout({ vertical: true });
        this.filter_sectors_scroll.add_actor(this.filter_sectors_scroll_box);

        this.custom_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.custom_filters_box);

        this.priority_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.priority_filters_box);

        this.context_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.context_filters_box);

        this.project_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.project_filters_box);


        this._add_separator(this.content_box);


        //
        // toggles sector
        //
        this.toggles_sector = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'filter-settings-sector' });
        this.content_box.add_child(this.toggles_sector);


        //
        // show hidden only switch
        //
        this.show_hidden_tasks_item = new St.BoxLayout({ reactive: true, style_class: 'row filter-window-item' });
        this.toggles_sector.add_child(this.show_hidden_tasks_item);

        let show_hidden_tasks_label = new St.Label({ text: _('Show hidden tasks only'), y_align: Clutter.ActorAlign.CENTER });
        this.show_hidden_tasks_item.add(show_hidden_tasks_label, {expand: true});

        let hidden_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_hidden_tasks_item.add_child(hidden_count_label);

        hidden_count_label.text =
            ngettext('%d hidden task', '%d hidden tasks', this.delegate.stats.hidden)
            .format(this.delegate.stats.hidden);

        this.show_hidden_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_hidden_tasks_item.add_actor(this.show_hidden_tasks_toggle_btn);
        this.show_hidden_tasks_toggle = new PopupMenu.Switch();
        this.nand_toggles.push(this.show_hidden_tasks_toggle);
        this.show_hidden_tasks_toggle_btn.add_actor(this.show_hidden_tasks_toggle.actor);


        //
        // show recurring only switch
        //
        this.show_recurring_tasks_item = new St.BoxLayout({ reactive: true, style_class: 'row filter-window-item' });
        this.toggles_sector.add_child(this.show_recurring_tasks_item);

        let show_recurring_tasks_label = new St.Label({ text: _('Show recurring tasks only'), y_align: Clutter.ActorAlign.CENTER });
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
        this.nand_toggles.push(this.show_recurring_tasks_toggle);
        this.show_recurring_tasks_toggle_btn.add_actor(this.show_recurring_tasks_toggle.actor);


        //
        // show deferred tasks only switch
        //
        this.show_deferred_tasks_item = new St.BoxLayout({ reactive: true, style_class: 'row filter-window-item' });
        this.toggles_sector.add_child(this.show_deferred_tasks_item);

        let show_deferred_tasks_label = new St.Label({ text: _('Show deferred tasks only'), y_align: Clutter.ActorAlign.CENTER });
        this.show_deferred_tasks_item.add(show_deferred_tasks_label, {expand: true});

        let deferred_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_deferred_tasks_item.add_child(deferred_count_label);

        let n_deferred = this.delegate.stats.deferred_tasks;

        deferred_count_label.text =
            ngettext('%d deferred task', '%d deferred tasks', n_deferred)
            .format(n_deferred);

        this.show_deferred_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_deferred_tasks_item.add_actor(this.show_deferred_tasks_toggle_btn);
        this.show_deferred_tasks_toggle = new PopupMenu.Switch();
        this.nand_toggles.push(this.show_deferred_tasks_toggle);
        this.show_deferred_tasks_toggle_btn.add_actor(this.show_deferred_tasks_toggle.actor);


        //
        // Invert switch (whitelist/blacklist)
        //
        this.invert_item = new St.BoxLayout({ reactive: true, style_class: 'row filter-window-item' });
        this.toggles_sector.add_child(this.invert_item);

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
        this.filter_sectors_scroll_box.connect('allocation-changed', () => {
            this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (this.ext.needs_scrollbar()) this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.show_hidden_tasks_toggle_btn.connect('clicked', () => this._on_nand_toggle_clicked(this.show_hidden_tasks_toggle));
        this.show_hidden_tasks_item.connect('button-press-event', () => this._on_nand_toggle_clicked(this.show_hidden_tasks_toggle));
        this.show_deferred_tasks_toggle_btn.connect('clicked', () => this._on_nand_toggle_clicked(this.show_deferred_tasks_toggle));
        this.show_deferred_tasks_item.connect('button-press-event', () => this._on_nand_toggle_clicked(this.show_deferred_tasks_toggle));
        this.show_recurring_tasks_toggle_btn.connect('clicked', () => this._on_nand_toggle_clicked(this.show_recurring_tasks_toggle));
        this.show_recurring_tasks_item.connect('button-press-event', () => this._on_nand_toggle_clicked(this.show_recurring_tasks_toggle));
        this.invert_toggle_btn.connect('clicked', () => this.invert_toggle.toggle());
        this.invert_item.connect('button-press-event', () => this.invert_toggle.toggle());
        this.button_reset.connect('clicked', () => this._reset_all());
        this.button_ok.connect('clicked', () => this._on_ok_clicked());
    }

    _load_filters () {
        let filters = this.delegate.get_current_todo_file().filters;

        this.invert_toggle.setToggleState(filters.invert_filters);
        this.show_hidden_tasks_toggle.setToggleState(filters.hidden);
        this.show_deferred_tasks_toggle.setToggleState(filters.deferred);
        this.show_recurring_tasks_toggle.setToggleState(filters.recurring);


        // custom filters
        for (let i = 0, len = filters.custom.length; i < len; i++) {
            let value = filters.custom[i];
            let check = filters.custom_active.indexOf(value) === -1 ? false : true;
            let item  = this._new_filter_item(check, value, 0, true, this.custom_filters_box);
            this.custom_filters_box.add_child(item.actor);
            this.filter_register.custom.push(item);
        }


        this._add_separator(this.priority_filters_box);


        // completed
        if (this.delegate.stats.completed > 0) {
            let item = this._new_filter_item(filters.completed, _('Completed'), this.delegate.stats.completed, 0, this.priority_filters_box);
            this.filter_register.completed = item;
            this.priority_filters_box.add_child(item.actor);
        }

        // no priority
        if (this.delegate.stats.no_priority > 0) {
            let item = this._new_filter_item(filters.no_priority, _('No Priority'), this.delegate.stats.no_priority, 0, this.priority_filters_box);
            this.filter_register.no_priority = item;
            this.priority_filters_box.add_child(item.actor);
        }


        // priorities
        for (let [key, value] of this.delegate.stats.priorities) {
            let check = filters.priorities.indexOf(key) === -1 ? false : true;
            this.filter_register.priorities.push(
                this._new_filter_item(check, key, value, false, this.priority_filters_box));
        }

        this.filter_register.priorities.sort((a, b) => {
            return +(a.filter > b.filter) || +(a.filter === b.filter) - 1;
        });

        for (let i = 0; i < this.filter_register.priorities.length; i++) {
            this.priority_filters_box.add_child(this.filter_register.priorities[i].actor);
        }


        this._add_separator(this.context_filters_box);


        // contexts
        for (let [key, value] of this.delegate.stats.contexts) {
            let check = filters.contexts.indexOf(key) === -1 ? false : true;
            let item  = this._new_filter_item(check, key, value, false, this.context_filters_box);
            this.context_filters_box.add_child(item.actor);
            this.filter_register.contexts.push(item);
        }


        this._add_separator(this.project_filters_box);


        // projects
        for (let [key, value] of this.delegate.stats.projects) {
            let check = filters.projects.indexOf(key) === -1 ? false : true;
            let item  = this._new_filter_item(check, key, value, false, this.project_filters_box);
            this.project_filters_box.add_child(item.actor);
            this.filter_register.projects.push(item);
        }


        // hide the sections that don't have any items
        [
            this.priority_filters_box,
            this.context_filters_box,
            this.project_filters_box,
        ].forEach((it) => it.get_n_children() === 1 && it.hide());
    }

    _reset_all () {
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
            for (let i = 0; i < arr.length; i++)
                arr[i].checkbox.actor.checked = false;
        });
    }

    _new_filter_item (is_checked, label, count, is_deletable, parent_box) {
        let item = {};

        item.actor = new St.BoxLayout({ reactive: true, style_class: 'row filter-window-item' });

        item.filter = label;

        item.label = new St.Label({ text: label, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        item.actor.add_child(item.label);

        if (count) {
            item.count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
            item.actor.add_child(item.count_label);
            item.count_label.text =
                ngettext('%d task', '%d tasks', count).format(count) + '   ';
        }

        item.checkbox = new CheckBox.CheckBox();
        item.actor.add_actor(item.checkbox.actor);
        item.checkbox.actor.checked = is_checked;
        item.checkbox.actor.y_align = St.Align.MIDDLE;

        if (is_deletable) {
            let close_button = new St.Button({ can_focus: true, style_class: 'close-icon' });
            item.actor.add_actor(close_button);
            close_button.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-close-symbolic') }));
            close_button.connect('clicked', () => this._delete_custom_item(item));
            close_button.connect('key-focus-in', () => MISC_UTILS.scroll_to_item(this.filter_sectors_scroll, this.filter_sectors_scroll_box, item.actor, parent_box));
        }

        item.actor.connect('button-press-event', () => { item.checkbox.actor.checked = !item.checkbox.actor.checked; });
        item.checkbox.actor.connect('key-focus-in', () => MISC_UTILS.scroll_to_item(this.filter_sectors_scroll, this.filter_sectors_scroll_box, item.actor, parent_box));

        return item;
    }

    _delete_custom_item (item) {
        if (item.checkbox.actor.has_key_focus || close_button.has_key_focus)
            this.entry.entry.grab_key_focus();

        item.actor.destroy();

        for (let i = 0; i < this.filter_register.custom.length; i++) {
            if (this.filter_register.custom[i] === item) {
                this.filter_register.custom.splice(i, 1);
                return;
            }
        }
    }

    _add_separator (container) {
        let sep = new PopupMenu.PopupSeparatorMenuItem();
        sep.actor.add_style_class_name('timepp-separator');
        container.add_child(sep.actor);
    }

    _on_nand_toggle_clicked (toggle_actor) {
        if (toggle_actor.state) {
            toggle_actor.setToggleState(false);
        } else {
            for (let toggle of this.nand_toggles) toggle.setToggleState(false);
            toggle_actor.setToggleState(true);
        }
    }

    _on_ok_clicked () {
        let filters = G.FILTER_RECORD();

        filters.invert_filters = this.invert_toggle.state;
        filters.deferred       = this.show_deferred_tasks_toggle.state;
        filters.recurring      = this.show_recurring_tasks_toggle.state;
        filters.hidden         = this.show_hidden_tasks_toggle.state;
        filters.completed      = !!(this.filter_register.completed && this.filter_register.completed.checkbox.actor.checked);
        filters.no_priority    = !!(this.filter_register.no_priority && this.filter_register.no_priority.checkbox.actor.checked);

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
    }

    close () {
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewFilters.prototype);

