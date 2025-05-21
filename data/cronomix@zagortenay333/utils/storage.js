import St from 'gi://St';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './fs.js';
import * as Pop from './popup.js';
import { PubSub } from './pubsub.js';
import { ScrollBox } from './scroll.js';
import { Button, CheckBox } from './button.js';
import { KeyMap, KeyMapPicker } from './keymap.js';
import { FilePicker, IntPicker, Dropdown } from './pickers.js';
import { unreachable, Row, focus_when_mapped } from './misc.js';

export class Storage extends PubSub {
    config;
    keymap = null;
    #flush_mainloop_id = 0;
    
    constructor(config) {
        super();
        this.config = config;
        this.#load_from_disk();
    }
    
    destroy() {
        this.unsubscribe_all();
        this.keymap?.destroy();
        
        if (this.#flush_mainloop_id) {
            GLib.source_remove(this.#flush_mainloop_id);
            this.#flush_mainloop_id = 0;
            this.flush();
        }
    }
    
    get read() {
        return this.config.values;
    }
    
    modify(key, fn) {
        const value = this.config.values[key];
        fn(value);
        this.publish(key, value);
        this.schedule_flush();
    }
    
    flush() {
        const content = JSON.stringify({ values: this.config.values }, null, 4);
        Fs.write_entire_file(this.config.file, content);
    }
    
    schedule_flush() {
        if (this.#flush_mainloop_id)
            return;
        
        this.#flush_mainloop_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.flush();
            this.#flush_mainloop_id = 0;
        });
    }
    
    init_keymap(callbacks) {
        if (this.keymap)
            return;
        
        this.keymap = new KeyMap();
        
        for (const [key, value] of Object.entries(this.config.values)) {
            if (value.tag !== 'keymap')
                continue;
            const callback = callbacks[key];
            if (callback)
                this.keymap.add(key, value.value, callback);
        }
    }
    
    #load_from_disk() {
        const file = Fs.read_entire_file(this.config.file);
        
        if (file) {
            const on_disk = JSON.parse(file);
            
            for (const key of Object.keys(on_disk.values)) {
                if (!this.config.values[key])
                    delete on_disk.values[key];
            }
            
            for (const key of Object.keys(this.config.values)) {
                if (!on_disk.values[key])
                    on_disk.values[key] = this.config.values[key];
            }
            
            for (const [key, value] of Object.entries(this.config.values)) {
                if (on_disk.values[key].tag !== value.tag)
                    on_disk.values[key] = value;
            }
            
            this.config.values = on_disk.values;
        }
        
        this.flush();
    }
    
    #translate(str) {
        return this.config.translations?.[str] ?? str;
    }
    
    // If @check returns a non-empty string (an error msg) the user
    // won't be able to commit their changes. When the user commits
    // the changes, @done will be called.
    render(done, check) {
        const scrollbox = new ScrollBox();
        scrollbox.box.add_style_class_name('cronomix-settings');
        const changed_values = new Map();
        const groups = this.config.groups ?? [Object.keys(this.config.values)];
        
        for (const group of groups) {
            const rows_box = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
            scrollbox.box.add_child(rows_box);
            
            for (const key of group) {
                const value = this.config.values[key];
                if (!value)
                    continue;
                
                const info = this.config.infos ? this.config.infos[key] : undefined;
                
                switch (value.tag) {
                    case 'boolean':
                        {
                            const checkbox = new CheckBox();
                            checkbox.checked = value.value;
                            checkbox.subscribe('left_click', () => { changed_values.set(key, value); value.value = checkbox.checked; });
                            new Row(this.#translate(key), checkbox.actor, rows_box, info);
                        }
                        break;
                    
                    case 'number':
                        {
                            const on_change = (val, valid) => { if (valid) {
                                changed_values.set(key, value);
                                value.value = val;
                            } };
                            const picker = new IntPicker(...value.range, value.value, 0, on_change);
                            new Row(this.#translate(key), picker.actor, rows_box, info);
                        }
                        break;
                    
                    case 'keymap':
                        {
                            const picker = new KeyMapPicker(value.value, (new_map) => {
                                changed_values.set(key, value);
                                value.value = new_map;
                                
                                if (this.keymap) {
                                    if (new_map) {
                                        this.keymap.change_shortcut(key, new_map);
                                    }
                                    else {
                                        this.keymap.disable(key);
                                    }
                                }
                            });
                            
                            new Row(this.#translate(key), picker.actor, rows_box, info);
                        }
                        break;
                    
                    case 'enum':
                        {
                            const display_values = value.enum.map(x => this.#translate(x));
                            
                            const dropdown = new Dropdown(value.value, value.enum, display_values, new_value => {
                                value.value = new_value;
                                changed_values.set(key, value);
                            });
                            
                            new Row(this.#translate(key), dropdown.actor.actor, rows_box, info);
                        }
                        break;
                    
                    case 'file':
                        {
                            const picker = new FilePicker({
                                path: value.value,
                                start: value.start,
                                on_change: (path) => { value.value = path; changed_values.set(key, value); }
                            });
                            
                            new Row(this.#translate(key), picker.actor, rows_box, info);
                        }
                        break;
                    
                    case 'custom': break;
                    default: unreachable(value);
                }
            }
        }
        
        //
        // buttons
        //
        const box = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        scrollbox.box.add_child(box);
        
        const done_button = new Button({ parent: box, wide: true, label: _('Ok') });
        const info_button = new Button({ parent: box, icon: 'cronomix-question-symbolic' });
        
        focus_when_mapped(done_button.actor);
        
        info_button.subscribe('left_click', () => {
            const msg = _('Right click any of the extension panel items to access the global settings.');
            Pop.show_info_popup(info_button, msg);
        });
        done_button.subscribe('left_click', () => {
            const error_msg = check?.(changed_values);
            
            if (error_msg) {
                Pop.show_error_popup(done_button, error_msg);
            }
            else {
                done(changed_values);
                this.schedule_flush();
                for (const [key, value] of changed_values)
                    this.publish(key, value);
            }
        });
        
        return scrollbox.actor;
    }
}
