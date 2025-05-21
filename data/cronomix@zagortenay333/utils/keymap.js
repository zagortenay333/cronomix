import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Button } from './button.js';

export class KeyMap {
    #bindings = new Map(); // The key is the binding id.
    #signal_id;
    
    constructor() {
        this.#signal_id = global.display.connect('accelerator-activated', (_, action) => {
            for (const [, binding] of this.#bindings) {
                if (binding.action === action) {
                    binding.callback();
                    break;
                }
            }
        });
    }
    
    destroy() {
        this.remove_all();
        if (this.#signal_id)
            global.display.disconnect(this.#signal_id);
    }
    
    add(id, shortcut, callback) {
        if (this.#bindings.has(id))
            return;
        
        const action = shortcut ? global.display.grab_accelerator(shortcut, 0) : null;
        
        if (action) {
            const name = Meta.external_binding_name_for_action(action);
            Main.wm.allowKeybinding(name, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.LOOKING_GLASS);
            this.#bindings.set(id, { action, name, callback });
        }
        else {
            this.#bindings.set(id, { action: 0, name: null, callback });
        }
    }
    
    remove(id) {
        const binding = this.#bindings.get(id);
        
        if (binding) {
            this.#disable(binding);
            this.#bindings.delete(id);
        }
    }
    
    remove_all() {
        for (const [, binding] of this.#bindings)
            this.#disable(binding);
        this.#bindings.clear();
    }
    
    disable(id) {
        const binding = this.#bindings.get(id);
        
        if (binding) {
            this.#disable(binding);
            binding.name = null;
        }
    }
    
    #disable(binding) {
        if (binding.name) {
            global.display.ungrab_accelerator(binding.action);
            Main.wm.allowKeybinding(binding.name, Shell.ActionMode.NONE);
        }
    }
    
    change_shortcut(id, shortcut) {
        const binding = this.#bindings.get(id);
        
        if (binding) {
            const callback = binding.callback;
            this.remove(id);
            this.add(id, shortcut, callback);
        }
    }
    
    change_callback(id, callback) {
        const binding = this.#bindings.get(id);
        if (binding)
            binding.callback = callback;
    }
}

export class KeyMapPicker {
    actor;
    
    #map;
    #on_change;
    
    constructor(map, on_change) {
        this.#map = map;
        this.#on_change = on_change;
        
        let waiting = false;
        const initial_msg = _('Set shortcut');
        
        const button = new Button({ style_class: 'cronomix-keymap-picker' });
        this.actor = button.actor;
        
        if (map) {
            button.set_label(map);
        }
        else {
            button.set_label(initial_msg);
            button.actor.add_style_class_name('unset');
        }
        
        button.subscribe('left_click', () => {
            button.set_label(_('Type shortcut (backspace to reset)'));
            button.actor.grab_key_focus();
            button.actor.add_style_class_name('waiting');
            button.actor.remove_style_class_name('unset');
            waiting = true;
        });
        
        this.actor.connect('captured-event', (_, e) => {
            if (!waiting)
                return Clutter.EVENT_PROPAGATE;
            
            const t = e.type();
            if (t !== Clutter.EventType.KEY_PRESS && t !== Clutter.EventType.KEY_RELEASE)
                return Clutter.EVENT_PROPAGATE;
            
            if (e.get_key_symbol() === Clutter.KEY_BackSpace) {
                this.#map = null;
                button.set_label(initial_msg);
                button.actor.add_style_class_name('unset');
            }
            else {
                this.#map = Meta.accelerator_name(e.get_state(), e.get_key_symbol());
                button.set_label(this.#map);
                button.actor.remove_style_class_name('unset');
            }
            
            if (t === Clutter.EventType.KEY_RELEASE) {
                waiting = false;
                this.#on_change(this.#map);
                button.actor.remove_style_class_name('waiting');
            }
            
            return Clutter.EVENT_STOP;
        });
    }
}
