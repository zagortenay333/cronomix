const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Meta      = imports.gi.Meta;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const DND  = ME.imports.lib.dnd;
const MISC = ME.imports.lib.misc_utils;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewSort
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals: 'update-sort'
// =====================================================================
var ViewSort = class ViewSort {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        //
        // draw
        //
        this.actor = new St.BoxLayout({ y_expand: true, x_expand: true, style_class: 'view-sort view-box' });

        this.content_box = new St.BoxLayout({ y_expand: true, x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);

        this.scrollview = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.scrollview);

        this.sort_items_box = new St.BoxLayout({ y_expand: true, x_expand: true, vertical: true, style_class: 'sort-items-box' });
        this.scrollview.add_actor(this.sort_items_box);


        //
        // create sort items
        //
        {
            let sort_text_map = {
                [G.SortType.PIN]             : _('Sort by Pin'),
                [G.SortType.CONTEXT]         : _('Sort by Context'),
                [G.SortType.PROJECT]         : _('Sort by Projects'),
                [G.SortType.PRIORITY]        : _('Sort by Priority'),
                [G.SortType.DUE_DATE]        : _('Sort by Due Date'),
                [G.SortType.ALPHABET]        : _('Sort by Alphabet'),
                [G.SortType.RECURRENCE]      : _('Sort by Recurrence Date'),
                [G.SortType.COMPLETED]       : _('Sort by Completed'),
                [G.SortType.CREATION_DATE]   : _('Sort by Creation Date'),
                [G.SortType.COMPLETION_DATE] : _('Sort by Completion Date'),
            };


            for (let it of this.delegate.get_current_todo_file().sorts) {
                let [sort_type, sort_order] = [it[0], it[1]];
                let item = new SortItem(delegate, this.scrollview, this.sort_items_box, sort_text_map[sort_type], sort_type, sort_order);
                this.sort_items_box.add_child(item.actor);
            }

        }


        {
            let sep = new PopupMenu.PopupSeparatorMenuItem();
            sep.actor.add_style_class_name('timepp-separator');
            this.content_box.add_child(sep.actor);
        }


        //
        // toggle automatic sort
        //
        this.toggle_automatic_sort = new St.BoxLayout({ x_expand: true, reactive: true, style_class: 'row' });
        this.content_box.add_child(this.toggle_automatic_sort);

        this.toggle_automatic_sort.add_child(new St.Label({ text: _('Automatic sorting'), x_expand: true, y_align: Clutter.ActorAlign.CENTER }));

        this.toggle_automatic_sort_btn = new St.Button({ can_focus: true });
        this.toggle_automatic_sort.add_actor(this.toggle_automatic_sort_btn);
        this.toggle = new PopupMenu.Switch();
        this.toggle_automatic_sort_btn.add_actor(this.toggle.actor);
        this.toggle.setToggleState(this.delegate.get_current_todo_file().automatic_sort);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);
        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button' });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.sort_items_box.connect('allocation-changed', () => {
            this.scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (this.ext.needs_scrollbar()) this.scrollview.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.button_ok.connect('clicked', () => this._on_ok_clicked());
        this.toggle_automatic_sort_btn.connect('clicked', () => this._on_toggle_clicked());
        this.toggle_automatic_sort.connect('button-press-event', () => this._on_toggle_clicked());
    }

    _on_ok_clicked () {
        let res = [];

        for (let it of this.sort_items_box.get_children())
            res.push([it._owner.sort_type, it._owner.sort_order]);

        this.emit('update-sort', res, this.toggle.state);
    }

    _on_toggle_clicked () {
        this.toggle.setToggleState(!this.toggle.state);
    }

    close () {
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewSort.prototype);



// =====================================================================
// @@@ SortItem
// =====================================================================
var SortItem = class SortItem{
    constructor (delegate, actor_scrollview, actor_parent, label, sort_type, sort_order) {
        this.delegate         = delegate;
        this.actor_scrollview = [[actor_scrollview], []];
        this.actor_parent     = actor_parent;
        this.label            = label;
        this.sort_type        = sort_type;
        this.sort_order       = sort_order;


        //
        // draw
        //
        this.actor = new St.BoxLayout({ x_expand: true, reactive: true, style_class: 'row' });
        this.actor._owner = this;

        this.label = new St.Label ({ x_expand: true, y_expand: true, text: label, reactive: true, y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this.label);

        this.icn_box = new St.BoxLayout({ style_class: 'icon-box' });
        this.actor.add_actor(this.icn_box);

        this.sort_icon = new St.Icon({ reactive: true, can_focus: true, track_hover: true });
        this.icn_box.add_actor(this.sort_icon);

        this.sort_icon.set_gicon(
            MISC.getIcon(
                sort_order === G.SortOrder.ASCENDING ?
                'timepp-sort-ascending-symbolic'   :
                'timepp-sort-descending-symbolic'
            )
        );


        //
        // DND
        //
        this.draggable = new DND.Draggable(this);


        //
        // listen
        //
        this.label.connect('enter-event', () => {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW);
        });
        this.label.connect('leave-event', () => {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.delegate.sigm.connect_press(this.sort_icon, Clutter.BUTTON_PRIMARY, true, () => {
            if (this.sort_order === G.SortOrder.ASCENDING) {
                this.sort_order = G.SortOrder.DESCENDING;
                this.sort_icon.gicon = MISC.getIcon('timepp-sort-descending-symbolic');
            } else {
                this.sort_order = G.SortOrder.ASCENDING;
                this.sort_icon.gicon = MISC.getIcon('timepp-sort-ascending-symbolic');
            }
        });
        this.sort_icon.connect('key-press-event', (_, event) => {
            if (event.get_state() !== Clutter.ModifierType.CONTROL_MASK)
                return Clutter.EVENT_PROPAGATE;

            let i        = 0;
            let children = this.actor_parent.get_children();

            for (; i < children.length; i++) {
                if (children[i] === this.actor) break;
            }

            if (event.get_key_symbol() === Clutter.KEY_Up && i > 0) {
                this.actor_parent.set_child_at_index(this.actor, --i);
                return Clutter.EVENT_STOP;
            } else if (event.get_key_symbol() === Clutter.KEY_Down && i < children.length - 1) {
                this.actor_parent.set_child_at_index(this.actor, ++i);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }
}
