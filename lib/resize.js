const St       = imports.gi.St;
const Meta     = imports.gi.Meta;
const Shell    = imports.gi.Shell;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const MISC = ME.imports.lib.misc_utils;


const ResizeDirection = {
    NORTH : "NORTH",
    SOUTH : "SOUTH",
    WEST  : "WEST",
    EAST  : "EAST",
    NE    : "NE",
    NW    : "NW",
    SE    : "SE",
    SW    : "SW",
};


// =====================================================================
// @@@ MakeResizable
// =====================================================================
var MakeResizable = class MakeResizable {
    constructor (actor) {
        this.actor = actor;

        this.actor.reactive = true;

        this.mouse_down       = false;
        this.resizing         = false;
        this.in_resize_pos    = false;
        this.resize_direction = "";
        this.start_box        = null;
        this.saved_style      = '';


        //
        // listen
        //
        this.actor.connect('motion-event', (_, event) => this._update_mouse_cursor(event));
        this.actor.connect('button-press-event', () => this._maybe_begin_resize());
        this.actor.connect('leave-event', () => {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
            this.in_resize_pos = false;
        });
    }

    _maybe_begin_resize () {
        if (! this.in_resize_pos) return;

        this.resizing = true;
        this.start_box = Shell.util_get_transformed_allocation(this.actor);

        // box-shadow tends to slow things down so remove it for the duration
        // of the resize.
        this.saved_style = this.actor.get_style();
        this.actor.style = 'box-shadow: 0 0 transparent !important;';

        this._resize();
        Main.panel.menuManager.ignoreRelease();
    }

    _update_mouse_cursor () {
        if (this.resizing) return;

        let a = Shell.util_get_transformed_allocation(this.actor);
        let [x, y,] = global.get_pointer();

        this.in_resize_pos = true;

        let w = 10;

        if (y > a.y1 && y < (a.y1 + w)) {
            if (x > a.x1 && x < (a.x1 + w)) {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.NW_RESIZE);
                this.resize_direction = ResizeDirection.NW;
            }
            else if (x > (a.x2 - w) && x < a.x2) {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.NE_RESIZE);
                this.resize_direction = ResizeDirection.NE;
            }
            else {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.NORTH_RESIZE);
                this.resize_direction = ResizeDirection.NORTH;
            }
        }
        else if (y > (a.y2 - w) && y < a.y2) {
            if (x > a.x1 && x < (a.x1 + w)) {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.SW_RESIZE);
                this.resize_direction = ResizeDirection.SW;
            }
            else if (x > (a.x2 - w) && x < a.x2) {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.SE_RESIZE);
                this.resize_direction = ResizeDirection.SE;
            }
            else {
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.SOUTH_RESIZE);
                this.resize_direction = ResizeDirection.SOUTH;
            }
        }
        else if (x > a.x1 && x < (a.x1 + w)) {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.WEST_RESIZE);
            this.resize_direction = ResizeDirection.WEST;
        }
        else if (x > (a.x2 - w) && x < a.x2) {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.EAST_RESIZE);
            this.resize_direction = ResizeDirection.EAST;
        }
        else {
            this.in_resize_pos = false;
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        }
    }

    _resize () {
        let [x, y, mask] = global.get_pointer();

        if (!(mask & Clutter.ModifierType.BUTTON1_MASK)) {
            this.resizing = false;
            this.actor.set_style(this.saved_style);
            return;
        }

        switch (this.resize_direction) {
          case ResizeDirection.NORTH:
            this.actor.set_height(this.start_box.y2 - y);
            break;
          case ResizeDirection.SOUTH:
            this.actor.set_height(y - this.start_box.y1);
            break;
          case ResizeDirection.WEST:
            this.actor.set_width(this.start_box.x2 - x);
            break;
          case ResizeDirection.EAST:
            this.actor.set_width(x - this.start_box.x1);
            break;
          case ResizeDirection.NE:
            this.actor.set_size(x - this.start_box.x1, this.start_box.y2 - y);
            break;
          case ResizeDirection.NW:
            this.actor.set_size(this.start_box.x2 - x, this.start_box.y2 - y);
            break;
          case ResizeDirection.SE:
            this.actor.set_size(x - this.start_box.x1, y - this.start_box.y1);
            break;
          case ResizeDirection.SW:
            this.actor.set_size(this.start_box.x2 - x, y - this.start_box.y1);
            break;
          default:
            return;
        }

        Mainloop.idle_add(() => this._resize());
    }
}
