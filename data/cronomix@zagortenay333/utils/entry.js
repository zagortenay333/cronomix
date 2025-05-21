import St from 'gi://St';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';

import * as Misc from './misc.js';
import { ScrollBox, scroll_to_widget } from './scroll.js';

export class Entry {
    actor;
    entry;
    
    history_pos = -1;
    history_locked = false;
    history = new Array();
    
    constructor(hint_text = '', scrollable = true) {
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true });
        
        const entry_container = new St.BoxLayout({ reactive: true, vertical: true });
        
        if (scrollable) {
            const scroll = new ScrollBox();
            this.actor.add_child(scroll.actor);
            scroll.actor.y_align = Clutter.ActorAlign.START;
            scroll.box.add_child(entry_container);
            scroll.actor.overlay_scrollbars = true;
        }
        else {
            this.actor.add_child(entry_container);
        }
        
        //
        // entry
        //
        this.entry = new St.Entry({ style_class: 'cronomix-entry', can_focus: true, hint_text: hint_text });
        entry_container.add_child(this.entry);
        
        this.entry.clutter_text.activatable = false;
        this.entry.clutter_text.single_line_mode = false;
        this.entry.clutter_text.line_wrap = true;
        this.entry.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        
        // TODO(GNOME_BUG): The actors inside StEntry are all vertically aligned
        // to the center, and this is the only way I could figure out how to snap
        // them all to the top. We need this to make resizing of the entry possible.
        const constraints = [];
        for (const it of this.entry.get_children()) {
            it.y_align = Clutter.ActorAlign.START;
            const constraint = new Clutter.SnapConstraint({ source: this.entry, from_edge: Clutter.SnapEdge.TOP, to_edge: Clutter.SnapEdge.TOP });
            constraints.push(constraint);
            it.add_constraint(constraint);
        }
        
        //
        // listen
        //
        let id = 0;
        this.entry.clutter_text.connect('text-changed', () => {
            if (id)
                GLib.source_remove(id);
            id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                id = 0;
                Misc.adjust_height(this.entry, this.entry.clutter_text);
            });
        });
        this.entry.connect('destroy', () => { if (id)
            GLib.source_remove(id); });
        entry_container.connect('button-press-event', () => this.entry.grab_key_focus());
        this.entry.connect('key-press-event', (_, event) => this.#maybe_resize_with_keyboard(event));
        this.entry.clutter_text.buffer.connect('inserted-text', (_, start, text) => {
            this.#add_history_entry({ tag: 'insert', start, text });
        });
        this.entry.clutter_text.connect('delete-text', (_, start, end) => {
            const text = this.entry.clutter_text.text.substring(start, end);
            this.#add_history_entry({ tag: 'delete', start, text });
        });
        this.entry.connect('notify::allocation', () => {
            Misc.run_before_redraw(() => {
                for (const it of constraints)
                    it.set_offset(this.entry.get_theme_node().get_vertical_padding() / 2);
            });
            Misc.adjust_height(this.entry, this.entry.clutter_text);
        });
        this.entry.clutter_text.connect('cursor-changed', () => {
            Misc.run_before_redraw(() => {
                const idx = this.entry.clutter_text.get_cursor_position();
                const line_box = Misc.get_line_box_at_idx(this.entry.clutter_text, idx);
                scroll_to_widget(this.entry, line_box);
            });
        });
        this.entry.clutter_text.connect('key-press-event', (_, event) => {
            const symbol = event.get_key_symbol();
            
            if (symbol === Clutter.KEY_z && event.has_control_modifier()) {
                this.undo();
                return Clutter.EVENT_STOP;
            }
            else if (symbol === Clutter.KEY_y && event.has_control_modifier()) {
                this.redo();
                return Clutter.EVENT_STOP;
            }
            else {
                return Clutter.EVENT_PROPAGATE;
            }
        });
    }
    
    set_cursor_pos(pos, scroll_to_top = false) {
        this.entry.clutter_text.set_cursor_position(pos);
        this.entry.clutter_text.set_selection_bound(pos);
        
        if (scroll_to_top) {
            const idx = this.entry.clutter_text.get_cursor_position();
            const line_box = Misc.get_line_box_at_idx(this.entry.clutter_text, idx);
            scroll_to_widget(this.entry, line_box, true);
        }
    }
    
    set_text(text, add_to_history = true) {
        const prev = this.history_locked;
        this.history_locked = !add_to_history;
        this.entry.set_text(text);
        this.history_locked = prev;
    }
    
    insert_text(text) {
        const pos = this.entry.clutter_text.get_cursor_position();
        
        if (pos === -1) {
            this.entry.text += text;
        }
        else {
            this.entry.set_text(this.entry.text.slice(0, pos) + text + this.entry.text.slice(pos));
            const p = pos + text.length;
            this.entry.clutter_text.set_selection(p, p);
        }
        
        return Clutter.EVENT_PROPAGATE;
    }
    
    undo_all() {
        while (this.undo())
            ;
    }
    
    undo() {
        const action = this.history[this.history_pos];
        if (!action)
            return false;
        
        this.history_locked = true;
        
        if (action.tag === 'insert') {
            this.entry.clutter_text.buffer.delete_text(action.start, action.text.length);
        }
        else {
            this.entry.clutter_text.buffer.insert_text(action.start, action.text, -1);
        }
        
        this.history_locked = false;
        this.history_pos--;
        return true;
    }
    
    redo() {
        const action = this.history[this.history_pos + 1];
        if (!action)
            return;
        
        this.history_locked = true;
        
        if (action.tag === 'insert') {
            this.entry.clutter_text.buffer.insert_text(action.start, action.text, -1);
        }
        else {
            this.entry.clutter_text.buffer.delete_text(action.start, action.text.length);
        }
        
        this.history_locked = false;
        this.history_pos++;
    }
    
    #add_history_entry(action) {
        if (!this.history_locked) {
            this.history_pos++;
            this.history.length = this.history_pos;
            this.history.push(action);
        }
    }
    
    #maybe_resize_with_keyboard(event) {
        if (!event.has_control_modifier())
            return;
        
        const n = 40;
        const [w, h] = this.entry.get_size();
        
        switch (event.get_key_symbol()) {
            case Clutter.KEY_h:
                this.entry.set_size(w + n, h);
                break;
            case Clutter.KEY_j:
                this.entry.set_size(w, h + n);
                break;
            case Clutter.KEY_k:
                this.entry.set_size(w, h - n);
                break;
            case Clutter.KEY_l:
                this.entry.set_size(w - n, h);
                break;
            default: return Clutter.EVENT_PROPAGATE;
        }
        
        return Clutter.EVENT_STOP;
    }
}
