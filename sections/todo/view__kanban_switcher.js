const St       = imports.gi.St;
const Gtk      = imports.gi.Gtk;
const Pango    = imports.gi.Pango;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ         = ME.imports.lib.fuzzy_search;
const MISC_UTILS   = ME.imports.lib.misc_utils;
const MULTIL_ENTRY = ME.imports.lib.multiline_entry;


const KAN_HELP_LINK = 'https://github.com/zagortenay333/timepp__gnome#todotxt-extensions';


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ KanbanSwitcher
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
var KanbanSwitcher = class KanbanSwitcher {
    constructor (ext, delegate, task) {
        this.ext      = ext;
        this.delegate = delegate;


        this.active_kan = null;
        this.kan_items  = new Set();


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'viwe-kanban-switcher view-box' });
        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_child(this.content_box);


        //
        // search files entry
        //
        this.entry_box = new St.BoxLayout({ vertical: true, style_class: 'row' });
        this.content_box.add_child(this.entry_box);

        this.entry = new St.Entry({ hint_text: _('Search...'), can_focus: true, x_expand: true, name: 'menu-search-entry' });
        this.entry_box.add_child(this.entry);


        //
        // help label
        //
        {
            this.help_label = new St.Button({ can_focus: true, reactive: true, x_align: St.Align.END, style_class: 'link' });
            this.entry_box.insert_child_at_index(this.help_label, 0);
            let label = new St.Label({ text: _('syntax help'), style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
            this.help_label.add_actor(label);
        }


        //
        // items
        //
        this.items_scrollview = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.NEVER, style_class: 'vfade' });
        this.content_box.add_actor(this.items_scrollview);

        this.items_scrollbox = new St.BoxLayout({ vertical: true, style_class: 'row' });
        this.items_scrollview.add_actor(this.items_scrollbox);


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(btn_box);

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true});
        this.button_cancel.visible = this.delegate.cache.todo_files.length > 0;


        //
        // listen
        //
        this.help_label.connect('clicked', () => MISC_UTILS.open_web_uri(KAN_HELP_LINK));
        this.items_scrollbox.connect('allocation-changed', () => {
            this.items_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar()) this.items_scrollview.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.button_cancel.connect('clicked', () => this.delegate.show_view__default());
        this.entry.clutter_text.connect('text-changed', () => this._search());
        this.entry.clutter_text.connect('activate', () => {
            let first = this.items_scrollbox.get_first_child();
            if (first) this._on_kanban_selected(first._delegate);
        });


        //
        // finally
        //
        this._init_items();
    }

    _init_items () {
        for (let it of this.delegate.tasks) {
            if (! it.kanban_boards) continue;
            for (let str of it.kanban_boards) this._add_new_item(str, it);
        }

        if (this.kan_items.size === 0) {
            this.entry_box.hide();
            this.items_scrollview.hide();

            let label = new St.Label({ text: _('To use kanban boards, add the kanban todo extension to a task.'), x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'row' });
            this.content_box.insert_child_at_index(label, 0);

            this.entry_box.remove_child(this.help_label);
            this.content_box.insert_child_at_index(this.help_label, 1);

            this.help_label.x_align = St.Align.MIDDLE;
            label = this.help_label.get_first_child();
            label.style_class = '';
            label.pseudo_style_class = '';
            label.clutter_text.set_markup(
                '<span foreground="' + this.ext.custom_css['-timepp-link-color'][0] +
                '"><u><b>' + label.text + '</b></u></span>');
        }
    }

    _add_new_item (kan_str, task) {
        let [name, rest, is_active] = this._parse_kan_str(kan_str);

        let item = {};
        this.kan_items.add(item);

        item.task      = task;
        item.kan_str   = kan_str
        item.is_active = is_active;


        // actor
        item.actor = new St.BoxLayout({ can_focus: true, reactive: true, vertical: true, style_class: 'kanban-switcher-item' });
        item.actor._delegate = item;


        // header
        item.header = new St.BoxLayout();
        item.actor.add_child(item.header);
        item.header.add_child(new St.Label({ text: name, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'kanban-switcher-item-title' }));


        // icons
        item.icon_box = new St.BoxLayout({ style_class: 'icon-box' });
        item.header.add_child(item.icon_box);

        item.check_icon = new St.Icon({ visible: false, track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-todo-symbolic'), style_class: 'file-switcher-item-check-icon' });
        item.icon_box.add_child(item.check_icon);

        let edit_icon = new St.Icon({ visible: false, track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-edit-symbolic') });
        item.icon_box.add_child(edit_icon);

        if (is_active && !this.active_kan) {
            this.active_kan = item;
            item.check_icon.visible = true;
            item.check_icon.add_style_class_name('active');
            this.items_scrollbox.insert_child_at_index(item.actor, 0);
        } else {
            this.items_scrollbox.add_child(item.actor);
        }


        // columns body
        item.msg = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        item.actor.add_child(item.msg);
        item.msg.clutter_text.line_wrap      = true;
        item.msg.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
        item.msg.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        let markup = "";
        for (let it of rest.split('|')) {
            markup += "\n  <b>-  " + it.replace(/,/g, ',  ') + "</b>";
        }
        item.msg.clutter_text.set_markup(markup.slice(1));


        // listen
        this.delegate.sigm.connect_release(item.check_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this._on_kanban_selected(item);
        });
        this.delegate.sigm.connect_release(edit_icon, Clutter.BUTTON_PRIMARY, true, () => this._on_edit_clicked(item));
        item.actor.connect('event', (_, event) => this._on_item_event(item, event));
    }

    _parse_kan_str (str) {
        let is_active = str[4] === '*';
        let name      = str.slice((is_active ? 5 : 4), str.indexOf('|'));
        let rest      = str.slice(str.indexOf('|')+1);

        return [name, rest, is_active];
    }

    _on_kanban_selected (item) {
        if (this.active_kan === item) {
            this.delegate.show_view__default();
            return;
        }

        if (this.active_kan) {
            let task        = this.active_kan.task;
            let new_kan_str = this.active_kan.kan_str.replace('*', '');
            task.reset(true, task.task_str.replace(this.active_kan.kan_str, new_kan_str));
        }

        {
            let task        = item.task;
            let new_kan_str = 'kan:*' + item.kan_str.slice(4);
            task.reset(true, task.task_str.replace(item.kan_str, new_kan_str));
        }

        this.delegate.on_tasks_changed(true, true);
    }

    _on_edit_clicked (item) {
        this.delegate.show_view__task_editor(item.task);
    }

    _search () {
        this.items_scrollbox.remove_all_children();
        let needle = this.entry.get_text().toLowerCase();

        if (!needle) {
            for (let it of this.kan_items) this.items_scrollbox.add_child(it.actor);
        } else {
            let reduced_results = [];

            for (let it of this.kan_items) {
                let score = FUZZ.fuzzy_search_v1(needle, it.kan_str);
                if (score) reduced_results.push([score, it]);
            }

            reduced_results.sort((a, b) => a[0] < b[0]);

            for (let it of reduced_results) this.items_scrollbox.add_child(it[1].actor);
        }
    }

    _on_item_event (item, event) {
        let event_type = event.type();

        if (event_type === Clutter.EventType.ENTER) {
            let related = event.get_related();
            if (related && !item.actor.contains(related))
                for (let it of item.icon_box.get_children()) it.show();
        }
        else if (event_type === Clutter.EventType.LEAVE) {
            let related = event.get_related();
            if (!item.header.contains(global.stage.get_key_focus()) && related && !item.actor.contains(related)) {
                for (let it of item.icon_box.get_children()) it.hide();
                item.check_icon.visible = item.is_active;
                item.actor.can_focus = true;
            }
        }
        else if (event_type === Clutter.EventType.KEY_RELEASE) {
            for (let it of item.icon_box.get_children()) it.show();
            if (!item.header.contains(global.stage.get_key_focus())) item.icon_box.get_first_child().grab_key_focus();
            MISC_UTILS.scroll_to_item(this.items_scrollview, this.items_scrollbox, item.actor);
            item.actor.can_focus = false;
        }
        else if (event_type === Clutter.EventType.KEY_PRESS) {
            Mainloop.idle_add(() => {
                if (item.icon_box && !item.header.contains(global.stage.get_key_focus())) {
                    item.actor.can_focus = true;
                    for (let it of item.icon_box.get_children()) it.hide();
                    item.check_icon.visible = item.is_active;
                }
            });
        }
    }

    close () {
        for (let it of this.kan_items) it.task = null;
        this.active_kan = null;
        this.kan_items.clear();
        this.actor.destroy();
  }
}
Signals.addSignalMethods(KanbanSwitcher.prototype);
