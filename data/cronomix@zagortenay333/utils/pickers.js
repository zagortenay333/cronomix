import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { PopupMenu } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { BoxPointer } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './fs.js';
import * as Pop from './popup.js';
import { Button } from './button.js';
import { Days, Time } from './time.js';

export class DaySelection {
    mon = true;
    tue = true;
    wed = true;
    thu = true;
    fri = true;
    sat = true;
    sun = true;
}

export class DayPicker {
    actor;
    selection;
    
    constructor(selection = new DaySelection()) {
        this.selection = selection;
        this.actor = new St.BoxLayout({ style: 'spacing: 3px;' });
        this.actor.layout_manager.homogeneous = true;
        
        for (const [day, translation] of Days) {
            const button = new Button({ parent: this.actor, wide: true, label: translation(), style_class: 'cronomix-floating-button' });
            button.checked = this.selection[day];
            button.subscribe('left_click', () => this.selection[day] = button.checked);
        }
    }
}

export class IntPicker {
    actor;
    min;
    max;
    init; // Returned by get_value() in case of error.
    on_change;
    
    #value;
    #entry;
    #left_pad;
    #error_button;
    
    constructor(min, max, init = min, left_pad = 0, on_change) {
        this.min = min;
        this.max = max;
        this.init = init;
        this.#left_pad = left_pad;
        if (on_change)
            this.on_change = on_change;
        
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'cronomix-int-picker' });
        
        this.#entry = new St.Entry({ can_focus: true, style_class: 'cronomix-entry' });
        this.actor.add_child(this.#entry);
        this.#entry.clutter_text.single_line_mode = false; // TODO(GNOME_BUG): Removes the warning 'clutter_input_focus_is_focused (focus)'.
        
        this.#error_button = new Button({ parent: this.actor, icon: 'cronomix-issue-symbolic' });
        
        this.#entry.clutter_text.connect('text-changed', () => this.#on_value_changed());
        this.#error_button.subscribe('left_click', () => Pop.show_error_popup(this.#error_button, `Input must be an integer in the range: **[${min}, ${max}]**`));
        this.actor.connect('scroll-event', (_, event) => {
            if (this.#error_button.actor.visible) {
                // Can't modify invalid input.
            }
            else if (event.get_scroll_direction() === Clutter.ScrollDirection.UP) {
                this.increment();
            }
            else if (event.get_scroll_direction() === Clutter.ScrollDirection.DOWN) {
                this.decrement();
            }
        });
        
        this.set_value(init);
    }
    
    #on_value_changed() {
        const input = this.#entry.text;
        
        let is_valid;
        
        if (/^-?[0-9]+$/.test(input)) {
            this.#value = parseInt(input);
            is_valid = (this.#value >= this.min) && (this.#value <= this.max);
        }
        else {
            is_valid = false;
        }
        
        if (is_valid) {
            this.actor.remove_style_class_name('invalid');
            this.#error_button.actor.visible = false;
        }
        else {
            this.actor.add_style_class_name('invalid');
            this.#error_button.actor.visible = true;
        }
        
        this.on_change?.(this.#value, is_valid);
    }
    
    increment() {
        if (this.#value < this.max)
            this.set_value(this.#value + 1);
    }
    
    decrement() {
        if (this.#value > this.min)
            this.set_value(this.#value - 1);
    }
    
    is_valid() {
        return !this.#error_button.actor.visible;
    }
    
    get_value() {
        return this.is_valid() ? this.#value : this.init;
    }
    
    set_value(value) {
        this.#entry.set_text(('' + value).padStart(this.#left_pad, '0'));
    }
}

export class TimePicker {
    actor;
    on_change;
    
    #hours;
    #minutes;
    #seconds;
    
    constructor(time, as_wallclock = false) {
        this.actor = new St.BoxLayout({ style_class: 'cronomix-time-picker' });
        
        this.#hours = new IntPicker(0, as_wallclock ? 23 : Number.MAX_SAFE_INTEGER, time?.hours ?? 0, 2, () => this.on_change?.(this.get_time()));
        this.actor.add_child(this.#hours.actor);
        
        this.actor.add_child(new St.Label({ text: ':', y_align: Clutter.ActorAlign.CENTER }));
        
        this.#minutes = new IntPicker(0, 59, time?.minutes ?? 0, 2, () => this.on_change?.(this.get_time()));
        this.actor.add_child(this.#minutes.actor);
        
        if (!as_wallclock) {
            this.actor.add_child(new St.Label({ text: ':', y_align: Clutter.ActorAlign.CENTER }));
            this.#seconds = new IntPicker(0, 59, time?.seconds ?? 0, 2, () => this.on_change?.(this.get_time()));
            this.actor.add_child(this.#seconds.actor);
        }
    }
    
    set_time(time) {
        this.#hours.set_value(time.hours);
        this.#minutes.set_value(time.minutes);
        this.#seconds?.set_value(time.seconds);
    }
    
    get_time() {
        const h = this.#hours.get_value();
        const m = this.#minutes.get_value();
        const s = this.#seconds?.get_value() ?? 0;
        const t = 3600 * h + 60 * m + s;
        return new Time(1000 * t);
    }
}

export class FilePicker {
    actor;
    entry;
    path;
    on_change;
    
    constructor({ parent = null, path = null, start = null, select_dirs = false, hint_text = null, on_change = null, } = {}) {
        this.path = path;
        if (on_change)
            this.on_change = on_change;
        if (!hint_text)
            hint_text = select_dirs ? _('Select folder') : _('Select file');
        
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'cronomix-file-picker' });
        parent?.add_child(this.actor);
        
        this.entry = new St.Entry({ x_expand: true, can_focus: true, style_class: 'cronomix-entry', hint_text: hint_text });
        this.actor.add_child(this.entry);
        if (path)
            this.entry.set_text(path);
        
        const find_button = new Button({ parent: this.actor, icon: 'cronomix-search-symbolic' });
        
        this.entry.clutter_text.connect('text-changed', () => {
            this.path = (this.entry.text === '') ? null : this.entry.text;
            this.on_change?.(this.path);
        });
        find_button.subscribe('left_click', () => {
            const popup = this.#try_get_popup();
            popup?.close();
            
            Fs.open_file_dialog(select_dirs, start, (path) => {
                popup?.open();
                this.entry.grab_key_focus();
                this.entry.set_text(path);
                this.path = path;
                this.on_change?.(path);
            });
        });
    }
    
    #try_get_popup() {
        let actor = this.actor;
        
        while (actor) {
            if (actor instanceof BoxPointer)
                break;
            actor = actor.get_parent();
        }
        
        const menu = actor._delegate;
        return (menu instanceof PopupMenu) ? menu : null;
    }
}

export class Dropdown {
    actor;
    current;
    on_change;
    
    #values;
    #display_values;
    
    constructor(current, values, display_values, // Parallel to @values argument.
    on_change) {
        this.current = current;
        this.#values = values;
        this.#display_values = display_values;
        if (on_change)
            this.on_change = on_change;
        
        const idx = values.indexOf(current);
        this.actor = new Button({ label: display_values[idx], icon: 'cronomix-pan-down-symbolic' });
        
        const icon = this.actor.icon;
        this.actor.actor.remove_child(icon);
        this.actor.actor.add_child(icon);
        
        this.actor.subscribe('left_click', () => {
            const popup = Pop.show_transient_popup(this.actor);
            
            for (const [idx, display_value] of display_values.entries()) {
                const button = new Button({ parent: popup.scrollbox.box, label: display_value, style_class: 'cronomix-menu-button' });
                if (display_value === this.actor.label?.text)
                    button.actor.grab_key_focus();
                
                button.subscribe('left_click', () => {
                    this.actor.set_label(display_value);
                    popup.close();
                    this.on_change?.(values[idx]);
                });
            }
        });
        this.actor.subscribe('scroll', direction => {
            const current = this.actor.label?.text ?? '';
            let idx = display_values.indexOf(current) + direction;
            idx = Math.max(0, Math.min(idx, values.length - 1));
            this.set_value(values[idx]);
            this.on_change?.(values[idx]);
        });
    }
    
    set_value(value) {
        this.current = value;
        const idx = this.#values.indexOf(value);
        this.actor.set_label(this.#display_values[idx]);
    }
}
