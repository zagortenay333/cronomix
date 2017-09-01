const St      = imports.gi.St;
const Meta    = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const DND     = imports.ui.dnd;
const Main    = imports.ui.main;
const Lang    = imports.lang;
const Signals = imports.signals;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ Sort UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals: 'update-sort'
// =====================================================================
const TaskSortWindow = new Lang.Class({
    Name: 'Timepp.TaskSortWindow',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.checked_sort_item  = null;
        this.dnd_pos            = null;
        this.dnd_placeholder    = null

        this.sort_text_map = {
            [G.SortType.CONTEXT]         : _('Sort by Context'),
            [G.SortType.PROJECT]         : _('Sort by Projects'),
            [G.SortType.PRIORITY]        : _('Sort by Priority'),
            [G.SortType.DUE_DATE]        : _('Sort by Due Date'),
            [G.SortType.COMPLETED]       : _('Sort by Completed'),
            [G.SortType.CREATION_DATE]   : _('Sort by Creation Date'),
            [G.SortType.COMPLETION_DATE] : _('Sort by Completion Date'),
        }


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box sort-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);

        this.sort_items_box = new St.BoxLayout({ vertical: true, style_class: 'sort-items-box' });
        this.content_box.add_child(this.sort_items_box);
        this.sort_items_box._delegate = this;


        //
        // create sort items
        //
        for (let i = 0; i < this.delegate.cache.sort.length; i++) {
            let it = this.delegate.cache.sort[i];
            this._new_sort_type_item(it[0], it[1]);
        }


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
        this.button_ok.connect('clicked', () => {
            this._on_ok_clicked();
        });
    },

    _on_ok_clicked: function () {
        let res      = [];
        let children = this.sort_items_box.get_children();

        for (let i = 0; i < children.length; i++) {
            let it = children[i]._delegate;
            res.push([it.sort_type, it.sort_order]);
        }

        this.emit('update-sort', res);
    },

    _new_sort_type_item: function (sort_type, sort_order) {
        let item = {};

        item.sort_type  = sort_type;
        item.sort_order = sort_order;

        item.actor = new St.BoxLayout({ reactive: true, style_class: 'row' });
        item.actor._delegate = item;
        item._delegate = this.sort_items_box;
        this.sort_items_box.add_child(item.actor);

        item.label = new St.Label ({ text: this.sort_text_map[sort_type], reactive: true, y_align: Clutter.ActorAlign.CENTER });
        item.actor.add(item.label, {expand: true});

        item.icn_box = new St.BoxLayout({ style_class: 'icon-box' });
        item.actor.add_actor(item.icn_box);

        item.sort_btn = new St.Button({ reactive: true, can_focus: true });
        item.icn_box.add_actor(item.sort_btn);

        item.sort_icon = new St.Icon();
        item.sort_btn.add_actor(item.sort_icon);

        item.sort_icon.set_icon_name(
            sort_order === G.SortOrder.ASCENDING ?
            'timepp-sort-ascending-symbolic'   :
            'timepp-sort-descending-symbolic'
        );


        // DND
        // Note that the various funcs that are being called from within
        // item._draggable rely on the '_delegate' property, so make sure that
        // the relevant actors have those, since we don't usually use the
        // '_delegate' pattern heavily in this extension.
        item._draggable = DND.makeDraggable(item.actor, { restoreOnSuccess: false, manualMode: false, dragActorOpacity: 0 });


        //
        // listen
        //
        item._draggable.connect('drag-begin', () => {
            if (! this.dnd_placeholder) {
                this.dnd_placeholder = new St.Bin();
                this.dnd_placeholder._delegate = this.sort_items_box;
                this.dnd_placeholder.set_width (item.actor.width);
                this.dnd_placeholder.set_height (item.actor.height);

                let i        = 0;
                let children = this.sort_items_box.get_children();

                for (; i < children.length; i++)
                    if (children[i] === item.actor) break;

                this.sort_items_box.insert_child_at_index(
                    this.dnd_placeholder, i);
            }
        });

        item._draggable.connect('drag-end', () => {
            item.actor.opacity = 255;

            if (this.dnd_placeholder) {
                this.dnd_placeholder.destroy();
                this.dnd_placeholder = null;
                this.dnd_pos         = null;
            }
        });

        item.sort_btn.connect('key-press-event', (_, event) => {
            if (event.get_state() !== Clutter.ModifierType.CONTROL_MASK)
                return Clutter.EVENT_PROPAGATE;

            let i        = 0;
            let children = this.sort_items_box.get_children();

            for (; i < children.length; i++)
                if (children[i] === item.actor) break;

            if (event.get_key_symbol() === Clutter.KEY_Up && i > 0) {
                this.sort_items_box.set_child_at_index(item.actor, --i);
                return Clutter.EVENT_STOP;
            }
            else if (event.get_key_symbol() === Clutter.KEY_Down &&
                     i < children.length - 1) {

                this.sort_items_box.set_child_at_index(item.actor, ++i);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        item.sort_btn.connect('clicked', () => {
            if (item.sort_order === G.SortOrder.ASCENDING) {
                item.sort_order = G.SortOrder.DESCENDING;
                item.sort_icon.icon_name = 'timepp-sort-descending-symbolic';
            }
            else {
                item.sort_order = G.SortOrder.ASCENDING;
                item.sort_icon.icon_name = 'timepp-sort-ascending-symbolic';
            }
        });

        item.label.connect('enter-event', () => {
            global.screen.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW);
        });

        item.label.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
    },

    // Called from within item._draggable.
    handleDragOver: function (source, actor, x, y, time) {
        if (source._delegate !== this.sort_items_box)
            return DND.DragMotionResult.NO_DROP;

        let children = this.sort_items_box.get_children();
        let pos      = children.length;

        while (--pos && y < children[pos].get_allocation_box().y1);

        this.dnd_pos = pos;

        this.sort_items_box.set_child_at_index(this.dnd_placeholder, this.dnd_pos);

        return DND.DragMotionResult.MOVE_DROP;
    },

    // Called from within item._draggable.
    acceptDrop: function (source, actor, x, y, time) {
        if (source._delegate !== this.sort_items_box || this.dnd_pos === null)
            return false;

        Main.uiGroup.remove_child(source.actor);
        this.sort_items_box.insert_child_at_index(source.actor, this.dnd_pos);

        return true;
    },
});
Signals.addSignalMethods(TaskSortWindow.prototype);
