const St       = imports.gi.St;
const Meta     = imports.gi.Meta;
const Shell    = imports.gi.Shell;
const Clutter  = imports.gi.Clutter;
const DND      = imports.ui.dnd;
const Lang     = imports.lang;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


// @NOTE
// A little dependency on another lib.
const MISC_UTILS = ME.imports.lib.misc_utils;


// This is the height of the an edge that runs along the top or bottom
// of the draggable actors.
const UPPER_LOWER_EDGE = 20;

// This is the width of an edge that runs along the right of the
// draggable actors.
const RIGHT_EDGE = 10;


let mainloop_id = null;


// =====================================================================
// @@@ Draggable
//
// @item : js obj
//
// ------------------------------------------------
//
// - This class assumes that @item has the following props:
//   - actor            : clutter actor
//   - actor_parent     : the actor that contains @actor
//   - actor_scrollview : (optional) StScrollView that contains @actor_parent
//   - owner            : (optional) a js obj
//       The owner can have two optional methods:
//         - on_drag_start
//         - on_drag_end
//
// - This class will add a '_delegate' property to @item.actor and set it
//   to the Draggable obj.
//
// ------------------------------------------------
//
// This is just a light wrapper around the existing dnd module to make
// usage more convenient.
// One only needs to instantiate this class and supply the arguments and
// that's it; no need to add any methods or connect to any signals.
//
// It also supports automatic scrolling:
//   - Each draggable item has an upper/lower edge. If the user hovers over
//     over this edge while dragging an item, then it will scroll one
//     item up/down.
//   - Each draggable item has a right edge. If the user hovers over
//     this edge while dragging an item, then it will scroll absolutely
//     to the position of the mouse.
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

        this.drag_enabled = true;
        this.drag_monitor = null;
        this.drag_end_id  = 0;
        this.dnd          = DND.makeDraggable(item.actor);
    },

    _on_item_dropped: function () {
        if (this.drag_end_id) {
            this.dnd.disconnect(this.drag_end_id);
            this.drag_end_id = 0;
        }

        if (! this.drag_enabled) return;

        this.item.actor.set_height(-1); // -1 to use preferred height
        this.item.actor.opacity = 255;

        if (this.drag_monitor) DND.removeDragMonitor(this.drag_monitor);
        this.drag_monitor = null;

        if (this.item.owner && this.item.owner.on_drag_end) {
            this.item.owner.on_drag_end(this.item);
        }
    },

    _on_drag_motion: function (drag_event) {
        if (this.drag_enabled) {
            if (drag_event.targetActor === this.item.actor_parent)
                return DND.DragMotionResult.MOVE_DROP;
            else
                return DND.DragMotionResult.CONTINUE;
        } else {
            return DND.DragMotionResult.CONTINUE;
        }
    },

    getDragActor: function () {
        if (! this.drag_enabled) return new St.Bin();

        let i_alloc = Shell.util_get_transformed_allocation(this.item.actor);

        let drag_actor;

        // If the height of the actor that is being dragged is too large, then
        // we reduce the placeholder height.
        // In addition, we also need to use a generic box for the drag actor
        // instead of a clone, because the clone is messed up due to the tweaked
        // height of the placeholder.
        if (this.item.actor.height > this.item.actor_parent.height - 2 * UPPER_LOWER_EDGE) {
            let [x, y] = global.get_pointer();
            drag_actor = new St.Widget({ opacity: 100, width: this.item.actor.width, height: 100, x: i_alloc.x1, y: y, style: 'border-radius: 3px; background: darkgrey' });
            this.item.actor.height = 100;
        } else {
            drag_actor = new Clutter.Clone({ width: this.item.actor.width, height: this.item.actor.height, x: i_alloc.x1, y: i_alloc.y1, source: this.item.actor, reactive: false });
        }

        this.drag_end_id = this.dnd.connect('drag-end', () => {
            this._on_item_dropped();
        });

        this.item.actor.opacity = 0;

        if (this.item.owner && this.item.owner.on_drag_start)
            this.item.owner.on_drag_start(this.item, drag_actor);

        return drag_actor;
    },

    handleDragOver: function (source, drag_actor, x, y, time) {
        if (! this.drag_enabled) return DND.DragMotionResult.CONTINUE;

        this.drag_monitor = { dragMotion: this._on_drag_motion.bind(this) };
        DND.addDragMonitor(this.drag_monitor);

        if (source.item === this.item) return DND.DragMotionResult.MOVE_DROP;


        let item_alloc = Shell.util_get_transformed_allocation(this.item.actor);
        let upper_y    = y;
        let lower_y    = y;

        // If the target actor is not fully scrolled into view, update the
        // y coord of the mouse so that the top/bottom edge is right at the
        // place where the actor is cut of.
        if (this.item.actor_scrollview) {
            let scroll_alloc = Shell.util_get_transformed_allocation(this.item.actor_scrollview);

            let delta = scroll_alloc.y1 - item_alloc.y1;
            if (delta > 0) upper_y -= delta;

            delta = item_alloc.y2 - scroll_alloc.y2;
            if (delta > 0) lower_y += delta;
        }

        // User hovered over right edge.
        if ((item_alloc.x2 - item_alloc.x1 - x) < RIGHT_EDGE && this.item.actor_scrollview) {
            if (mainloop_id) Mainloop.source_remove(mainloop_id);

            mainloop_id = Mainloop.timeout_add(100, () => {
                let a      = source.item.actor_scrollview.get_vscroll_bar().get_adjustment();
                let [x, y] = global.get_pointer();
                [, x, y]   = this.item.actor_scrollview.transform_stage_point(x, y);

                a.set_value(y / a.page_size * a.upper)

                mainloop_id = null;
            });
        }
        // User hovered over top edge.
        else if (upper_y < UPPER_LOWER_EDGE) {
            if (this.item.actor.get_previous_sibling() !== source.item.actor)
                this.item.actor_parent.set_child_below_sibling(source.item.actor, this.item.actor);

            this._maybe_scroll(source, -1);
        }
        // User hovered over bottom edge.
        else if ((item_alloc.y2 - item_alloc.y1 - lower_y) < UPPER_LOWER_EDGE) {
            if (this.item.actor.get_next_sibling() !== source.item.actor)
                this.item.actor_parent.set_child_above_sibling(source.item.actor, this.item.actor);

            this._maybe_scroll(source, 1);
        }

        return DND.DragMotionResult.MOVE_DROP;
    },

    _maybe_scroll: function (placeholder, direction) {
        if (! this.item.actor_scrollview) return;

        // If the actor that comes after/before the placeholder is either not in
        // view, or it's less than the height of the edge we use for scroll
        // detection, then we must scroll it into view.
        let item;

        if (direction === 1) item = placeholder.item.actor.get_next_sibling();
        else                 item = placeholder.item.actor.get_previous_sibling();

        if (item) {
            let item_alloc   = Shell.util_get_transformed_allocation(item);
            let scroll_alloc = Shell.util_get_transformed_allocation(this.item.actor_scrollview);

            if (direction === 1) {
                if (scroll_alloc.y2 - item_alloc.y1 > UPPER_LOWER_EDGE)
                    item = null;
            } else if (item_alloc.y2 - scroll_alloc.y1 > UPPER_LOWER_EDGE) {
                item = null;
            }
        }

        if (! item) item = placeholder.item.actor;

        if (mainloop_id) Mainloop.source_remove(mainloop_id);

        mainloop_id = Mainloop.timeout_add(100, () => {
            MISC_UTILS.scroll_to_item(placeholder.item.actor_scrollview, placeholder.item.actor_parent, item);
            mainloop_id = null;
        });
    },
});
