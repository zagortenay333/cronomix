const St       = imports.gi.St;
const Meta     = imports.gi.Meta;
const Pango    = imports.gi.Pango;
const Clutter  = imports.gi.Clutter;

const Mainloop = imports.mainloop;


// =====================================================================
// Multi-line Entry
//
// @hint_text        : string
// @scrollable       : bool (make entry use scrollbar or grow indefinitely)
// @single_line_mode : bool (removes any line breaks, still wraps)
// =====================================================================
var MultiLineEntry = class MultiLineEntry{
    constructor (hint_text, scrollable, single_line_mode) {
        this.scrollable       = scrollable;
        this.single_line_mode = single_line_mode;

        this.automatic_newline_insert = true;
        this.keep_min_height          = true;
        this.resize_with_keyboard     = false;

        this.constraints   = [];
        this.sanitize_flag = false;

        //
        // draw
        //
        this.actor = new St.BoxLayout({ y_expand: true, vertical: true });

        this.entry_container = new St.BoxLayout({ reactive: true, vertical: true });

        if (scrollable) {
            this.scroll_box = new St.ScrollView({ x_fill: true, y_align: St.Align.START, style_class: 'multiline-entry-scrollbox vfade'});
            this.actor.add(this.scroll_box);
            this.scroll_box.add_actor(this.entry_container);
        } else {
            this.actor.add_actor(this.entry_container);
        }

        this.entry = new St.Entry({ can_focus: true, hint_text: hint_text, name: 'menu-search-entry' });
        this.entry_container.add_actor(this.entry);

        this.entry.clutter_text.single_line_mode = false;
        this.entry.clutter_text.line_wrap        = true;
        this.entry.clutter_text.line_wrap_mode   = Pango.WrapMode.WORD_CHAR;

        // The actors inside StEntry are all vertically aligned to the center,
        // and this is the only way I could figure out how to snap them all to
        // the top.
        // We need this in order to make resizing of the entry possible.
        for (let it of this.entry.get_children()) {
            it.y_align = Clutter.ActorAlign.START;
            let constraint = new Clutter.SnapConstraint({ source: this.entry, from_edge: Clutter.SnapEdge.TOP, to_edge: Clutter.SnapEdge.TOP });
            this.constraints.push(constraint);
            it.add_constraint(constraint);
        }


        //
        // listen
        //
        if (single_line_mode) this.entry.clutter_text.connect('insert-text', (_, ...args) => this._before_text_changed(...args));
        this.entry.clutter_text.connect('activate', () => { if (this.automatic_newline_insert) this.insert_text('\n'); });
        this.entry.clutter_text.connect('text-changed', () => this._after_text_changed());
        this.entry_container.connect('button-press-event', () => this.entry.grab_key_focus());
        this.entry.connect('allocation_changed', () => {
            for (let it of this.constraints) it.set_offset(this.entry.get_theme_node().get_vertical_padding());
            this._resize_entry();
        });
        this.entry.connect('key-press-event', (_, event) => {
            return this._maybe_resize_with_keyboard(event);
        });
    }

    set_text (text) {
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.entry.set_text(text);
            Mainloop.timeout_add(0, () => this._resize_entry());
        });
    }

    insert_text (text) {
        if (this.single_line_mode) return Clutter.EVENT_PROPAGATE;

        let pos = this.entry.clutter_text.cursor_position;

        if (pos === -1) {
            this.entry.text += text;
        } else {
            this.entry.text = this.entry.text.slice(0, pos) + text + this.entry.text.slice(pos);
            let p = pos + text.length;
            this.entry.clutter_text.set_selection(p, p);
        }
    }

    _before_text_changed (added_text, length_of_added_text) {
        // If the text was pasted in (longer than 1 char) or is a newline, set
        // the sanitize flag to true so that after_text_changed cleans the line
        // breaks.
        if (length_of_added_text > 1 || /\r?\n/g.test(added_text))
            this.sanitize_flag = true;
    }

    _after_text_changed () {
        if (this.sanitize_flag) {
            let txt = this.entry.get_text();
            this.entry.set_text(txt.replace(/[\r\n]/g, ' '));
            this.sanitize_flag = false;
        }

        this._resize_entry();
    }

    _maybe_resize_with_keyboard (event) {
        if (! this.resize_with_keyboard) return;
        if (event.get_state() !== Clutter.ModifierType.CONTROL_MASK) return;

        let a = 40;
        let [w, h] = this.entry.get_size();

        switch (event.get_key_symbol()) {
          case Clutter.KEY_h:
            this.entry.set_size(w+a, h);
            break;
          case Clutter.KEY_j:
            this.entry.set_size(w, h+a);
            break;
          case Clutter.KEY_k:
            this.entry.set_size(w, h-a);
            break;
          case Clutter.KEY_l:
            this.entry.set_size(w-a, h);
            break;
          default:
            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_STOP;
    }

    _resize_entry () {
        let theme_node     = this.entry.get_theme_node();
        let a              = this.entry.get_allocation_box();
        let [, nat_height] = this.entry.clutter_text.get_preferred_height(theme_node.adjust_for_width(a.x2 - a.x1));
        let h              = nat_height + theme_node.get_vertical_padding()*2;

        let entry_h = theme_node.adjust_for_height(a.y2 - a.y1);
        if (this.keep_min_height || entry_h <= h) this.entry.set_height(h);
    }
}
