const St       = imports.gi.St;
const Gtk      = imports.gi.Gtk;
const GLib     = imports.gi.GLib;
const Pango    = imports.gi.Pango;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ            = ME.imports.lib.fuzzy_search;
const MULTIL_ENTRY    = ME.imports.lib.multiline_entry;
const MISC_UTILS      = ME.imports.lib.misc_utils;
const REG             = ME.imports.lib.regex;
const TEXT_LINKS_MNGR = ME.imports.lib.text_links_manager;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewFileSwitcher
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//   - 'update'
// =====================================================================
var ViewFileSwitcher = class ViewFileSwitcher {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        this.linkm            = new TEXT_LINKS_MNGR.TextLinksManager();
        this.file_items       = new Set();
        this.file_info_editor = null;


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-file-switcher view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_child(this.content_box);


        //
        // search files entry
        //
        this.entry_box = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add(this.entry_box);
        this.entry_box.visible = this.delegate.cache.todo_files.length > 0;

        this.entry = new St.Entry({ hint_text: _('Search...'), can_focus: true, x_expand: true, name: 'menu-search-entry' });
        this.entry_box.add_child(this.entry);


        //
        // file items container
        //
        this.file_items_scrollview = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.file_items_scrollview);
        this.file_items_scrollview.visible = this.delegate.cache.todo_files.length > 0;
        this.file_items_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.file_items_scrollview.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.file_items_scrollbox = new St.BoxLayout({ vertical: true, style_class: 'row' });
        this.file_items_scrollview.add_actor(this.file_items_scrollbox);

        for (let file of this.delegate.cache.todo_files) {
            this._add_new_file_item(file);
        }


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(btn_box);

        this.button_add_file = new St.Button({ can_focus: true, label: _('Add File'), style_class: 'button', x_expand: true });
        btn_box.add(this.button_add_file, {expand: true});

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true});
        this.button_cancel.visible = this.delegate.cache.todo_files.length > 0;

        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        this.button_ok.visible = this.delegate.cache.todo_files.length > 0;
        btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.file_items_scrollbox.connect('allocation-changed', () => {
            this.file_items_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar()) this.file_items_scrollview.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.entry.clutter_text.connect('text-changed', () => this._search());
        this.button_add_file.connect('clicked', () => this._show_file_editor());
        this.button_cancel.connect('clicked', () => this.emit('cancel'));
        this.button_ok.connect('clicked', () => this._on_file_selected());
        this.entry.clutter_text.connect('activate', () => this._select_first());
    }

    _search () {
        this.file_items_scrollbox.remove_all_children();
        let needle = this.entry.get_text().toLowerCase();

        if (!needle) {
            for (let it of this.file_items)
                this.file_items_scrollbox.add_child(it.actor);
        } else {
            let reduced_results = [];

            for (let it of this.file_items) {
                let msg = (it.file.name + it.file.todo_file + it.file.done_file + it.file.time_tracker_dir).toLowerCase();
                let score = FUZZ.fuzzy_search_v1(needle, msg);
                if (score) reduced_results.push([score, it]);
            }

            reduced_results.sort((a, b) => a[0] < b[0]);

            for (let it of reduced_results)
                this.file_items_scrollbox.add_child(it[1].actor);
        }
    }

    _show_file_editor (item) {
        if (this.file_info_editor) this.file_info_editor.close();

        this.file_info_editor = new FileInfoEditor(this.ext, this.delegate, item ? item.file : null);
        this.actor.add_child(this.file_info_editor.actor);

        let is_active = item && item.active;

        this.file_info_editor.button_cancel.grab_key_focus();
        this.content_box.hide();

        this.file_info_editor.connect('ok', (_, file) => {
            if (item) {
                this.file_items.delete(item);
                item.actor.destroy();
            } else {
                file.active = true;
                for (let it of this.file_items) {
                    if (it.active) {
                        file.active = false;
                        break;
                    }
                }
            }

            this._add_new_file_item(file);

            this.content_box.show();
            this.entry_box.show();
            this.file_items_scrollview.show();
            this.button_cancel.show();
            this.button_ok.show();
            this.button_ok.grab_key_focus();

            this.file_info_editor.close();
            this.file_info_editor = null;
        });

        this.file_info_editor.connect('delete', () => {
            this.file_items.delete(item);
            item.actor.destroy();

            if (is_active) {
                for (let it of this.file_items) {
                    it.file.active = true;
                    it.check_icon.add_style_class_name('active');
                    it.check_icon.show();
                    break;
                }
            }

            this.content_box.show();
            this.entry.grab_key_focus();

            this.file_info_editor.close();
            this.file_info_editor = null;
        });

        this.file_info_editor.connect('cancel', () => {
            this.content_box.show();
            this.entry.grab_key_focus();

            this.file_info_editor.close();
            this.file_info_editor = null;
        });
    }

    _add_new_file_item (file) {
        let item = {};
        this.file_items.add(item);

        item.file = file;

        item.actor = new St.BoxLayout({ can_focus: true, reactive: true, vertical: true, style_class: 'file-switcher-item' });
        item.actor._delegate = item;

        item.header = new St.BoxLayout();
        item.actor.add_child(item.header);

        item.header.add_child(new St.Label({ text: file.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'file-switcher-item-title' }));

        item.icon_box = new St.BoxLayout({ style_class: 'icon-box' });
        item.header.add_child(item.icon_box);
        item.check_icon = new St.Icon({ visible: false, track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-todo-symbolic'), style_class: 'file-switcher-item-check-icon' });
        item.icon_box.add_child(item.check_icon);
        let edit_icon = new St.Icon({ visible: false, track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-edit-symbolic') });
        item.icon_box.add_child(edit_icon);

        {
            item.msg = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
            item.actor.add_child(item.msg);

            item.msg.clutter_text.line_wrap      = true;
            item.msg.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
            item.msg.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

            let markup = file.todo_file;

            if (file.done_file)        markup += '\n' + file.done_file;
            if (file.time_tracker_dir) markup += '\n' + file.time_tracker_dir;

            this.linkm.add_label_actor(item.msg, new Map([[REG.FILE_PATH, MISC_UTILS.open_file_path]]));
            item.msg.clutter_text.set_markup(this.highlight_tokens(markup));
        }

        if (file.active) {
            item.active = true;
            item.check_icon.show();
            item.check_icon.add_style_class_name('active');
            this.file_items_scrollbox.insert_child_at_index(item.actor, 0);
        } else {
            item.active = false;
            this.file_items_scrollbox.add_child(item.actor);
        }

        // listen
        this.delegate.sigm.connect_release(item.check_icon, Clutter.BUTTON_PRIMARY, true, () => this._on_file_selected(file));
        this.delegate.sigm.connect_release(edit_icon, Clutter.BUTTON_PRIMARY, true, () => this._show_file_editor(item));
        item.actor.connect('key-focus-in', () => { item.actor.can_focus = false; });
        item.actor.connect('event', (_, event) => this._on_file_item_event(item, event));


        return item;
    }

    _select_first () {
        let c = this.file_items_scrollbox.get_first_child();
        if (!c) return;
        this._on_file_selected(c._delegate.file);
    }

    _on_file_selected (file) {
        let files = [];

        for (let it of this.file_items) {
            if (file) it.file.active = (it.file.name === file.name);
            files.push(it.file);
        }

        this.emit('update', files);
    }

    highlight_tokens (text) {
        text = GLib.markup_escape_text(text, -1);
        text = MISC_UTILS.markdown_to_pango(text, this.ext.markdown_map);
        text = MISC_UTILS.split_on_whitespace(text);

        let token;

        for (let i = 0; i < text.length; i++) {
            token = text[i];

            if (! REG.FILE_PATH.test(token)) continue;

            text[i] =
                '<span foreground="' + this.ext.custom_css['-timepp-link-color'][0] +
                '"><u><b>' + token + '</b></u></span>';
        }

        return text.join('');
    }

    _on_file_item_event (item, event) {
        switch (event.type()) {
          case Clutter.EventType.ENTER: {
            let related = event.get_related();
            if (related && !item.actor.contains(related)) {
                for (let it of item.icon_box.get_children()) it.show();
            }
          } break;

          case Clutter.EventType.LEAVE: {
            let related = event.get_related();
            if (!item.header.contains(global.stage.get_key_focus()) && related && !item.actor.contains(related)) {
                for (let it of item.icon_box.get_children()) it.hide();
                item.check_icon.visible = item.active;
                item.actor.can_focus = true;
            }
          } break;

          case Clutter.EventType.KEY_RELEASE: {
            for (let it of item.icon_box.get_children()) it.show();
            if (!item.header.contains(global.stage.get_key_focus())) item.icon_box.get_first_child().grab_key_focus();
            MISC_UTILS.scroll_to_item(this.file_items_scrollview, this.file_items_scrollbox, item.actor);
            item.actor.can_focus = false;
          } break;

          case Clutter.EventType.KEY_PRESS: {
            Mainloop.idle_add(() => {
                if (item.icon_box && !item.header.contains(global.stage.get_key_focus())) {
                    item.actor.can_focus = true;
                    for (let it of item.icon_box.get_children()) it.hide();
                    item.check_icon.visible = item.active;
                }
            });
          } break;
        }
    }

    close () {
        if (this.file_info_editor) this.file_info_editor.close();
        this.file_info_editor = null;
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewFileSwitcher.prototype);



// =====================================================================
// @@@ FileInfoEditor
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @file     : obj
//
// @signals: 'ok', 'cancel', 'delete'
// =====================================================================
var FileInfoEditor = class FileInfoEditor {
    constructor (ext, delegate, file) {
        this.ext      = ext;
        this.delegate = delegate;
        this.file     = file;


        this.todo_file_chooser_proc    = null;
        this.done_file_chooser_proc    = null;
        this.tracker_file_chooser_proc = null;


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });


        // unique name
        {
            let row = new St.Bin({ style_class: 'row' });
            this.actor.add_child(row);
            this.name_entry = new St.Entry({ hint_text: _('Unique name'), can_focus: true });
            row.add_actor(this.name_entry);

            if (file) this.name_entry.text = file.name;
        }

        // todo file path
        {
            let row = new St.Bin({ style_class: 'row' });
            this.actor.add_child(row);

            this.todo_entry = new St.Entry({ hint_text: _('Todo file'), can_focus: true });
            row.add_actor(this.todo_entry);

            this.todo_search_icon = new St.Icon({ track_hover: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-search-symbolic') });
            this.todo_entry.set_secondary_icon(this.todo_search_icon);

            if (file) this.todo_entry.text = file.todo_file;
        }

        // done file path
        {
            let row = new St.Bin({ style_class: 'row' });
            this.actor.add_child(row);

            let hint = `${_('Done file')} (${_('optional')})`;
            this.done_entry = new St.Entry({ hint_text: hint, can_focus: true });
            row.add_actor(this.done_entry);

            this.done_search_icon = new St.Icon({ track_hover: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-search-symbolic') });
            this.done_entry.set_secondary_icon(this.done_search_icon);

            if (file) this.done_entry.text = file.done_file;
        }

        // time tracker dir path
        {
            let row = new St.Bin({ style_class: 'row' });
            this.actor.add_child(row);

            let hint = `${_('Time-tracker directory')} (${_('optional')})`;
            this.tracker_entry = new St.Entry({ hint_text: hint, can_focus: true });
            row.add_actor(this.tracker_entry);

            this.tracker_search_icon = new St.Icon({ track_hover: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-search-symbolic') });
            this.tracker_entry.set_secondary_icon(this.tracker_search_icon);

            if (file) this.tracker_entry.text = file.time_tracker_dir;
        }


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.actor.add(btn_box, {expand: true});

        if (file) {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            btn_box.add(this.button_delete, {expand: true});
            this.button_delete.connect('clicked', () => this.emit('delete'));
        }

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        this.button_ok     = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true});
        btn_box.add(this.button_ok, {expand: true});
        this._update_ok_btn();


        //
        // listen
        //
        this.todo_search_icon.connect('button-press-event', () => {
            if (this.todo_file_chooser_proc) this.todo_file_chooser_proc.force_exit();
            this.ext.menu.close();
            this.todo_file_chooser_proc = MISC_UTILS.open_file_dialog(false, (out) => {
                this.todo_entry.set_text(out);
                this.todo_file_chooser_proc = null;
                this.ext.menu.open();
            });
        });
        this.done_search_icon.connect('button-press-event', () => {
            if (this.done_file_chooser_proc) this.done_file_chooser_proc.force_exit();
            this.ext.menu.close();
            this.done_file_chooser_proc = MISC_UTILS.open_file_dialog(false, (out) => {
                this.done_entry.set_text(out);
                this.done_file_chooser_proc = null;
                this.ext.menu.open();
            });
        });
        this.tracker_search_icon.connect('button-press-event', () => {
            if (this.tracker_file_chooser_proc) this.tracker_file_chooser_proc.force_exit();
            this.ext.menu.close();
            this.tracker_file_chooser_proc = MISC_UTILS.open_file_dialog(true, (out) => {
                this.tracker_entry.set_text(out);
                this.tracker_file_chooser_proc = null;
                this.ext.menu.open();
            });
        });
        this.button_ok.connect('clicked', () => this._on_ok_clicked());
        this.button_cancel.connect('clicked', () => this.emit('cancel'));
        this.name_entry.clutter_text.connect('text-changed', () => this._update_ok_btn());
        this.todo_entry.clutter_text.connect('text-changed', () => this._update_ok_btn());
    }

    _on_ok_clicked () {
        let file = this.file;

        if (! file) file = G.TODO_RECORD();

        file.name             = this.name_entry.text,
        file.todo_file        = this.todo_entry.text,
        file.done_file        = this.done_entry.text,
        file.time_tracker_dir = this.tracker_entry.text,
        file.automatic_sort   = file ? file.automatic_sort : true,

        this.emit('ok', file);
    }

    _update_ok_btn () {
        if (!this.name_entry.text || !this.todo_entry.text) {
            this.button_ok.visible = false;
            return;
        }

        let name = this.name_entry.get_text();

        if (this.file && this.file.name === name) {
            this.button_ok.visible = true;
            return;
        }

        for (let file of this.delegate.cache.todo_files) {
            if (file.name === name) {
                this.button_ok.visible = false;
                return;
            }
        }

        this.button_ok.visible = true;
    }

    close () {
        if (this.todo_file_chooser_proc) this.todo_file_chooser_proc.force_exit();
        if (this.done_file_chooser_proc) this.done_file_chooser_proc.force_exit();
        if (this.tracker_file_chooser_proc) this.tracker_file_chooser_proc.force_exit();
        this.actor.destroy();
    }
}
Signals.addSignalMethods(FileInfoEditor.prototype);
