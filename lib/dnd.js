const St       = imports.gi.St;
const Meta     = imports.gi.Meta;
const Shell    = imports.gi.Shell;
const Main     = imports.ui.main;
const Clutter  = imports.gi.Clutter;
const DND      = imports.ui.dnd;
const GLib     = imports.gi.GLib;
const Mainloop = imports.mainloop;

const ME = imports.misc.extensionUtils.getCurrentExtension();
const MISC = ME.imports.lib.misc_utils;

var DragMotionResult = DND.DragMotionResult;

const EDGE_WIDTH = 20;

let scroll_loop_id   = null;
let scroll_speed     = 40;
let scroll_direction = -1;

let target = null;
let scrollbar_init_grab_coord = null; // null or [x, y]

// =====================================================================
// @@@ Draggable
//
// @item: js obj
//
// NOTE: This class sets the '_delegate' property of @item.actor to
// @@@Draggable. Make sure you don't '_delegate' for anything else.
//
// This class assumes that @item has the following props:
//   - actor            : clutter actor (that is being dragged)
//   - actor_parent     : the actor that contains @actor
//   - actor_scrollview : (optional) array of 2 arrays [[], []]
//                        first is an array of vertical StScrollView's
//                        second is an array of horizontal StScrollView's
//   - owner            : (optional) js obj
//       The owner can have two optional methods:
//         - on_drag_start (params: @item, drag_actor)
//         - on_drag_end   (params: @old_parent, @new_parent, @item)
//
// This is just a light wrapper around the existing dnd module to make
// usage more convenient.
// One only needs to instantiate this class and supply the arguments and
// that's it; no need to add any methods or connect to any signals although it's
// possible.
//
// Some scrolling features exist:
//   - The user can move a scrollbar by hovering over it while dragging an item.
//   - The scrollview's specified in @actor_scrollview will automatically start
//     scrolling if the user moves mouse close to the edges while dragging.
//
// The original dnd module doesn't have a clean way to make an item not
// draggable once it's been made draggable (at least I couldn't find any).
// This class makes this possible with the 'this.drag_enabled' prop. But make
// sure that you set this prop on the dnd instance of every draggable item.
// =====================================================================
var Draggable = class Draggable {
    constructor (item, dnd_group, vertical = true) {
        this.item      = item;
        this.dnd_group = dnd_group || "";
        this.vertical  = vertical;

        item.actor._delegate = this;
        item.actor.reactive  = true;

        this.original_parent = null;
        this.drag_enabled    = true;
        this.drag_monitor    = null;
        this.drag_end_id     = 0;
        this.dnd             = DND.makeDraggable(item.actor);

        // We have to patch the _maybeStartDrag() function
        // so that disabling of dragging works correctly.
        let orig = this.dnd._maybeStartDrag;
        this.dnd._maybeStartDrag = (event) => {
            if (!this.drag_enabled || !this.item.actor.mapped) {
                this.dnd.fakeRelease();
                return true;
            }

            return orig.call(this.dnd, event);
        };
    }

    _on_item_dropped () {
        // @HACK We need to reset this manually or else the
        // maybeStartDrag func will never be called.
        this.dnd._dragState = DND.DragState.INIT;

        this._stop_scroll_loop();

        if (this.drag_end_id) {
            this.dnd.disconnect(this.drag_end_id);
            this.drag_end_id = 0;
        }

        target = null;

        if (this.drag_monitor) DND.removeDragMonitor(this.drag_monitor);
        this.drag_monitor = null;

        if (!this.drag_enabled || !this.item.actor_parent) return;

        this.item.actor.set_height(-1); // -1 to use preferred height
        this.item.actor.opacity = 255;

        if (this.item.owner && this.item.owner.on_drag_end) {
            this.item.owner.on_drag_end(this.original_parent, this.item.actor_parent, this.item);
        }

        this.original_parent = null;
    }

    _on_drag_motion (drag_event) {
        // @HACK This function must always return DND.DragMotionResult.CONTINUE;
        //
        // This comment applies to at least gnome shell 3.36 and 3.38 source codes.
        //
        // I'm not sure if this is a bug in gnome shell or a misunderstanding
        // on my part. In the gnome shell file ui/dnd.js inside the function
        // _updateDragHover(), the function handleTargetActorDestroyClosure()
        // is connected on the 'destory' signal and it never gets disconnected
        // if any of the motion callbacks (like this one) doesn't always return
        // DND.DragMotionResult.CONTINUE.
        //
        // This then leads to an error when a drag target (like a kanban column)
        // gets destroyed upon dropping it. The error will be something like
        // 'this._dragActor is null' caused by the call to _pickTargetActor()
        // inside handleTargetActorDestroyClosure() that never got disconnected.
        let result = DND.DragMotionResult.CONTINUE;

        if (!this.drag_enabled || drag_event.source !== this) return result;

        let t = drag_event.targetActor;

        if (t.name === 'hhandle' || t.name === 'vhandle' || t.adjustment || t.name === 'trough') {
            this._stop_scroll_loop();

            let bar;
            let scrollview = t;
            let sentinel = 10;

            while (! scrollview.get_vscroll_bar) {
                if (scrollview.get_adjustment) bar = scrollview;
                scrollview = scrollview.get_parent();
                if (--sentinel === 0) break;
            }

            if (! bar) {
                scrollbar_init_grab_coord = null;
                return result;
            }

            let [x, y,] = global.get_pointer();
            let a       = bar.get_adjustment();

            if (! scrollbar_init_grab_coord) {
                scrollbar_init_grab_coord = [x, y, a.get_value()];
                return result;
            }

            let [dx, dy] = [x - scrollbar_init_grab_coord[0], y - scrollbar_init_grab_coord[1]];
            let scale    = a.upper / a.page_size;

            a.set_value(scrollbar_init_grab_coord[2] + (bar.vertical ? dy : dx) * scale);

            return result;
        } else {
            scrollbar_init_grab_coord = null;
        }

        let scrollviews = this.item.actor_scrollview;
        if (target && target.item.actor_scrollview) scrollviews = target.item.actor_scrollview;

        let found = false;

        if (scrollviews) {
            let [x, y,] = global.get_pointer();

            outer: for (let i = 0; i < 2; i++) {
                for (let s of scrollviews[i]) {
                    let a = MISC.get_transformed_allocation(s);

                    let edge, upper, lower, coor;

                    if (i === 0) { // vertical
                        coor  = y;
                        edge  = .1 * (a.y2 - a.y1);
                        upper = a.y1 + edge;
                        lower = a.y2 - edge;
                    } else { // horizontal
                        coor  = x;
                        edge  = .07 * (a.x2 - a.x1);
                        upper = a.x1 + edge;
                        lower = a.x2 - edge;
                    }

                    if (coor < upper) {
                        let delta        = (edge + 20) - upper + coor;
                        scroll_speed     = (delta < 10) ? scroll_speed : delta;
                        scroll_direction = -1;
                        this._start_scroll_loop(s, i);
                        found = true;
                        break outer;
                    } else if (coor > lower) {
                        let delta        = (edge + 20) - coor + lower;
                        scroll_speed     = (delta < 10) ? scroll_speed : delta;
                        scroll_direction = 1;
                        this._start_scroll_loop(s, i);
                        found = true;
                        break outer;
                    }
                }
            }
        }

        if (! found) this._stop_scroll_loop();

        return result;
    }

    getDragActor () {
        // If this function fails for some reason, it'll cause a nasty deadlock
        // that will require a shell restart, so we wrap it in a try-catch.
        try {
            if (!this.drag_enabled || !this.item.actor_parent) return new St.Bin();

            this.drag_monitor = { dragMotion: this._on_drag_motion.bind(this) };
            DND.addDragMonitor(this.drag_monitor);

            let i_alloc             = MISC.get_transformed_allocation(this.item.actor);
            let drag_actor          = new Clutter.Clone({ width: this.item.actor.width, height: this.item.actor.height, x: i_alloc.x1, y: i_alloc.y1, source: this.item.actor, reactive: false });
            this.drag_end_id        = this.dnd.connect('drag-end', () => this._on_item_dropped());
            this.item.actor.opacity = 0;

            this.original_parent = this.item.actor_parent;

            if (this.item.owner && this.item.owner.on_drag_start)
                this.item.owner.on_drag_start(this.item, drag_actor);

            return drag_actor;
        } catch (e) {
            logError(e);
            if (this.drag_monitor) DND.removeDragMonitor(this.drag_monitor);
            this.original_parent = null;
            this.drag_monitor = null;
            return new St.Bin();
        }
    }

    handleDragOver (source, drag_actor, x, y, time) {
        if (!this.drag_enabled)                  return DND.DragMotionResult.CONTINUE;
        if (source.item === this.item)           return DND.DragMotionResult.MOVE_DROP;
        if (source.dnd_group !== this.dnd_group) return DND.DragMotionResult.CONTINUE;

        target = this;

        let a = MISC.get_transformed_allocation(this.item.actor);

        if (this.vertical) {
            if (y < (a.y2 - a.y1) / 2) this._set_below(source.item, this.item);
            else                       this._set_above(source.item, this.item);
        } else {
            if (x < (a.x2 - a.x1) / 2) this._set_below(source.item, this.item);
            else                       this._set_above(source.item, this.item);
        }

        return DND.DragMotionResult.MOVE_DROP;
    }

    _set_above (first, second) {
        if (second.actor.get_next_sibling() === first.actor) return;

        first.actor_parent.remove_child(first.actor);
        first.actor_parent = second.actor_parent;
        first.actor_parent.insert_child_above(first.actor, second.actor);
    }

    _set_below (first, second) {
        if (second.actor.get_previous_sibling() === first.actor) return;

        first.actor_parent.remove_child(first.actor);
        first.actor_parent = second.actor_parent;
        first.actor_parent.insert_child_below(first.actor, second.actor);
    }

    _start_scroll_loop (scrollview, direction) {
        this._stop_scroll_loop();
        this._scroll(scrollview, direction);
    }

    _stop_scroll_loop () {
        if (!scroll_loop_id) return;
        Mainloop.source_remove(scroll_loop_id);
        scroll_loop_id = null;
    }

    _scroll (scrollview, direction) {
        let vbar = direction ? scrollview.get_hscroll_bar() : scrollview.get_vscroll_bar();
        if (!vbar) return;

        let a = vbar.get_adjustment();
        a.set_value(20 * scroll_direction + a.get_value());

        scroll_loop_id = Mainloop.timeout_add(scroll_speed, () => this._scroll(scrollview, direction));
    }
}
