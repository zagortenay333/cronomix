const St       = imports.gi.St;
const Meta     = imports.gi.Meta;
const Shell    = imports.gi.Shell;
const Clutter  = imports.gi.Clutter;
const DND      = imports.ui.dnd;
const Lang     = imports.lang;
const Mainloop = imports.mainloop;


// Height of edges that run along the top/bottom of the draggable actors.
const UPPER_LOWER_EDGE = 20;

let scroll_loop_id   = null;
let scroll_speed     = 40;
let scroll_direction = -1;


// =====================================================================
// @@@ Draggable
//
// @item: js obj
//
// ------------------------------------------------
//
// - NOTE: This class will add a '_delegate' property to @item.actor and set it
//   to @@@Draggable!!
//   Make sure you don't use this prop for anything else.
//
// - This class assumes that @item has the following props:
//   - actor            : clutter actor (that is being dragged)
//   - actor_parent     : the actor that contains @actor
//   - actor_scrollview : (optional) StScrollView that contains @actor_parent
//   - owner            : (optional) js obj
//       The owner can have two optional methods:
//         - on_drag_start (params: @item, drag_actor)
//         - on_drag_end   (params: @item)
//
// ------------------------------------------------
//
// This is just a light wrapper around the existing dnd module to make
// usage more convenient.
// One only needs to instantiate this class and supply the arguments and
// that's it; no need to add any methods or connect to any signals.
//
// It also supports automatic scrolling (only for vertical scrolling for now):
//   - The user can move the scrollbar by hovering over it while dragging
//     an item.
//   - The scrollbar will automatically starts scrolling if the user has
//     moved the mouse close to the upper/lower edges of the scrollview.
//
// The original dnd module doesn't have a clean way to make an item not
// draggable once it's been made draggable (at least I couldn't find any).
// This class makes this possible with the 'this.drag_enabled' prop. But make
// sure that you set this prop on the dnd instance of every draggable item.
// =====================================================================
var Draggable = new Lang.Class({
    Name: 'Timepp.Draggable',

    _init: function (item) {
        this.item = item;

        item.actor._delegate = this;

        this.scroll_view_alloc = null;
        this.upper_lower_edge_scroll = 100;

        this.drag_enabled = true;
        this.drag_monitor = null;
        this.drag_end_id  = 0;
        this.dnd          = DND.makeDraggable(item.actor);
    },

    _on_item_dropped: function () {
        if (scroll_loop_id) {
            Mainloop.source_remove(scroll_loop_id);
            scroll_loop_id = null;
        }

        if (this.drag_end_id) {
            this.dnd.disconnect(this.drag_end_id);
            this.drag_end_id = 0;
        }

        if (this.drag_monitor) DND.removeDragMonitor(this.drag_monitor);
        this.drag_monitor = null;

        this.scroll_view_alloc = null;

        if (!this.drag_enabled || !this.item.actor_parent) return;

        this.item.actor.set_height(-1); // -1 to use preferred height
        this.item.actor.opacity = 255;

        if (this.item.owner && this.item.owner.on_drag_end)
            this.item.owner.on_drag_end(this.item);
    },

    _on_drag_motion: function (drag_event) {
        if (! this.drag_enabled) return DND.DragMotionResult.CONTINUE;

        let t = drag_event.targetActor;

        let res = (t === this.item.actor_parent) ?
                  DND.DragMotionResult.MOVE_DROP :
                  DND.DragMotionResult.CONTINUE;

        if (! this.item.actor_scrollview) return res;

        // The way we check whether the mouse is on the scrollbar is ugly but
        // fast..
        if (t.get_adjustment || t.name === 'vhandle' || t.name  === 'trough') {
            let vbar    = this.item.actor_scrollview.get_vscroll_bar();
            let [x, y,] = global.get_pointer();
            [, , y]     = vbar.transform_stage_point(x, y);
            let a       = vbar.get_adjustment();

            a.set_value(y / a.page_size * a.upper);

            return res;
        }

        // User hovered over top/bottom edge of the scrollview maybe.
        if (this.scroll_view_alloc) {
            let upper_y = this.scroll_view_alloc.y1 + this.upper_lower_edge_scroll;
            let lower_y = this.scroll_view_alloc.y2 - this.upper_lower_edge_scroll;
            let [x, y,] = global.get_pointer();

            if (y < upper_y) {
                let delta = this.upper_lower_edge_scroll + 10 - upper_y + y;
                scroll_speed = delta < 10 ? scroll_speed : delta;

                scroll_direction = -1;
                if (! scroll_loop_id) this._start_scroll_loop();
            }
            else if (y > lower_y) {
                let delta = this.upper_lower_edge_scroll + 10 - y + lower_y;
                scroll_speed = delta < 10 ? scroll_speed : delta;

                scroll_direction = 1;
                if (! scroll_loop_id) this._start_scroll_loop();
            }
            else if (scroll_loop_id) {
                Mainloop.source_remove(scroll_loop_id);
                scroll_loop_id = null;
            }
        }

        return res;
    },

    getDragActor: function () {
        // If this function fails for some reason, it'll cause a nasty deadlock
        // that will require starting a tty to restart gnome-shell.
        try {
            if (!this.drag_enabled || !this.item.actor_parent) return new St.Bin();

            this.drag_monitor = { dragMotion: this._on_drag_motion.bind(this) };
            DND.addDragMonitor(this.drag_monitor);

            // We want to get the allocation only once for the duration of one
            // drag; otherwise, the _on_drag_motion() func will cause lag due
            // this operation.
            // The allocation of the scrollview is probably not gonna change
            // for the duration of a drag.
            // We also dynamically update the size of the upper/lower edges.
            if (this.item.actor_scrollview) {
                this.scroll_view_alloc = Shell.util_get_transformed_allocation(this.item.actor_scrollview);
                this.upper_lower_edge_scroll = .2 * (this.scroll_view_alloc.y2 - this.scroll_view_alloc.y1);
            }

            let i_alloc             = Shell.util_get_transformed_allocation(this.item.actor);
            let drag_actor          = new Clutter.Clone({ width: this.item.actor.width, height: this.item.actor.height, x: i_alloc.x1, y: i_alloc.y1, source: this.item.actor, reactive: false });
            this.drag_end_id        = this.dnd.connect('drag-end', () => this._on_item_dropped());
            this.item.actor.opacity = 0;

            if (this.item.owner && this.item.owner.on_drag_start)
                this.item.owner.on_drag_start(this.item, drag_actor);

            return drag_actor;
        } catch (e) {
            logError(e);
            if (this.drag_monitor) DND.removeDragMonitor(this.drag_monitor);
            this.drag_monitor = null;
            return new St.Bin();
        }
    },

    handleDragOver: function (source, drag_actor, x, y, time) {
        if (!this.drag_enabled)
            return DND.DragMotionResult.CONTINUE;

        if (source.item === this.item) return DND.DragMotionResult.MOVE_DROP;

        let item_alloc = Shell.util_get_transformed_allocation(this.item.actor);
        let upper_y    = y;
        let lower_y    = y;

        // User hovered over top edge.
        if (upper_y < UPPER_LOWER_EDGE) {
            if (this.item.actor.get_previous_sibling() !== source.item.actor)
                this.item.actor_parent.set_child_below_sibling(source.item.actor, this.item.actor);
        }
        // User hovered over bottom edge.
        else if ((item_alloc.y2 - item_alloc.y1 - lower_y) < UPPER_LOWER_EDGE) {
            if (this.item.actor.get_next_sibling() !== source.item.actor)
                this.item.actor_parent.set_child_above_sibling(source.item.actor, this.item.actor);
        }

        return DND.DragMotionResult.MOVE_DROP;
    },

    _start_scroll_loop: function () {
        if (scroll_loop_id) return;
        this._scroll();
    },

    _scroll: function () {
        let vbar = this.item.actor_scrollview.get_vscroll_bar();

        if (!vbar) return;

        let a = vbar.get_adjustment();

        a.set_value(10 * scroll_direction + a.get_value());

        scroll_loop_id = Mainloop.timeout_add(scroll_speed, () => this._scroll());
    },
});
