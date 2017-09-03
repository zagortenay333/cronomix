const St      = imports.gi.St;
const Gtk     = imports.gi.Gtk;
const Main    = imports.ui.main;
const Lang    = imports.lang;
const Signals = imports.signals;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ           = ME.imports.lib.fuzzy_search;
const MULTIL_ENTRY   = ME.imports.lib.multiline_entry;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ File Switcher
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//   - 'switch' (returns the unique name of the new todo file)
//   - 'close'
// =====================================================================
var TodoFileSwitcher = new Lang.Class({
    Name: 'Timepp.TodoFileSwitcher',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.todo_files   = delegate.settings.get_value('todo-files')
                             .deep_unpack();
        this.current_name = delegate.settings.get_value('todo-current')
                             .deep_unpack().name;

        this.file_items    = []; // the ones created with _load_items()
        this.selected_item = null;


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box todo-switcher-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // search entry
        //
        let entry_container = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row' });
        this.content_box.add_child(entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Search files...'), false, true);
        entry_container.add_child(this.entry.actor);


        //
        // todo file items
        //
        this.items_scroll = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.items_scroll);

        this.items_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.items_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.items_scroll_content = new St.BoxLayout({ vertical: true });
        this.items_scroll.add_actor(this.items_scroll_content);

        this._load_items();


        //
        // listen
        //
        this.delegate.settings.connect('changed::todo-files', () => {
            this.emit('close');
        });
        this.entry.entry.clutter_text.connect('text-changed', () => {
            this._search_files();
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (this.selected_item &&
                this.selected_item.name !== this.current_name) {

                this.emit('switch', this.selected_item.name);
            }
            else {
                this.emit('close');
            }
        });
        this.items_scroll_content.connect('queue-redraw', () => {
            this.items_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar())
                this.items_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    _load_items: function () {
        let it, item, is_current, current_item;

        for (let i = 0, len = this.todo_files.length; i < len; i++) {
            it = this.todo_files[i];
            is_current = (it.name === this.current_name);

            item = {};

            item.name = it.name;

            item.actor = new St.Button({ can_focus: true, reactive: true, x_fill: true, x_align: St.Align.START, track_hover: true, style_class: 'row popup-menu-item' });
            item.actor._delegate = item;

            let content = new St.BoxLayout();
            item.actor.add_actor(content);

            item.label = new St.Label ({ text: it.name, x_expand: true });
            content.add_child(item.label);

            if (is_current) {
                current_item = item;
                content.add_child(new St.Label({ text: _('current file'), margin_left: 8, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' }));
            }
            else {
                this.items_scroll_content.add_child(item.actor);
                this.file_items.push(item);
            }

            item.actor.connect('notify::hover', (item) => {
                item.grab_key_focus();
            });
            item.actor.connect('key-focus-in', (item) => {
                if (this.selected_item)
                    this.selected_item.actor.pseudo_class = '';

                this.selected_item = item._delegate;
                item.pseudo_class  = 'active';

                SCROLL_TO_ITEM.scroll(this.items_scroll,
                                      this.items_scroll_content,
                                      item);
            });
            item.actor.connect('clicked', (item) => {
                // Destroy the actor before emiting to get rid of any signals
                // that are set on the actor.
                // In particular, the 'key-focus-in' signal calls SCROLL_TO_ITEM
                // which will call get_allocation_box() at a bad time and will
                // cause clutter to spit assertion errors.
                let name = item._delegate.name;
                item.destroy();

                if (name !== this.current_name) this.emit('switch', name)
                else                            this.emit('close');
            });
        }

        this.items_scroll_content.insert_child_at_index(current_item.actor, 0);
        this.file_items.unshift(current_item);

        this.selected_item              = current_item;
        current_item.actor.pseudo_class = 'active';
    },

    _search_files: function () {
        let needle = this.entry.entry.get_text().toLowerCase();
        let len    = this.file_items.length;

        if (!needle) {
            this.items_scroll_content.remove_all_children();

            for (let i = 0; i < len; i++) {
                this.items_scroll_content.add_child(this.file_items[i].actor);
            }
        }
        else {
            let reduced_results = [];
            let i, item, score;

            for (i = 0; i < len; i++) {
                item = this.file_items[i];

                score = FUZZ.fuzzy_search_v1(
                    needle, item.label.text.toLowerCase());

                if (score) reduced_results.push([score, item]);
            }

            reduced_results.sort((a, b) => a[0] < b[0]);

            this.items_scroll_content.remove_all_children();

            for (i = 0, len = reduced_results.length; i < len; i++) {
                this.items_scroll_content.add_child(reduced_results[i][1].actor);
            }
        }

        if (this.selected_item) this.selected_item.actor.pseudo_class = '';

        let first_child = this.items_scroll_content.get_first_child();

        if (first_child) {
            this.selected_item       = first_child._delegate;
            first_child.pseudo_class = 'active';
        }
        else {
            this.selected_item = null;
        }
    },
});
Signals.addSignalMethods(TodoFileSwitcher.prototype);
