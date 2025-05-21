import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Button } from './../../utils/button.js';
import { show_info_popup } from './../../utils/popup.js';
import { unreachable, Card, focus_when_mapped } from './../../utils/misc.js';

export function compare_tasks(schema, a, b) {
    for (const entry of schema) {
        let A = a.ast.config[entry.by];
        let B = b.ast.config[entry.by];
        
        if (A !== B) {
            let result;
            
            switch (entry.by) {
                case 'pin':
                case 'done':
                case 'hide':
                    A ??= false;
                    B ??= false;
                    result = +A - +B;
                    break;
                case 'priority':
                    A ??= Number.MAX_SAFE_INTEGER;
                    B ??= Number.MAX_SAFE_INTEGER;
                    result = +A - +B;
                    break;
                case 'due':
                    A ??= '9999-99-99';
                    B ??= '9999-99-99';
                    result = (a < b) ? -1 : 1;
                    break;
                default:
                    unreachable(entry.by);
            }
            
            return (entry.direction === 'asc') ? result : -result;
        }
    }
    
    return 0;
}

export class SortView {
    actor;
    
    constructor(applet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });
        
        const box = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        this.actor.add_child(box);
        
        for (const [idx, entry] of applet.storage.read.sort.value.entries()) {
            const item = new SortViewItem(applet, entry, idx);
            box.add_child(item.actor);
        }
        
        const hint_msg = _('Tasks are sorted by the first attribute in this list.\n' +
            'In case of a tie, by the second attribute, and so on...');
        
        const button_box = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        this.actor.add_child(button_box);
        
        const ok_button = new Button({ parent: button_box, wide: true, label: _('Ok') });
        const help_button = new Button({ parent: button_box, icon: 'cronomix-question-symbolic' });
        
        ok_button.subscribe('left_click', () => applet.show_main_view());
        help_button.subscribe('left_click', () => show_info_popup(help_button, hint_msg));
        
        focus_when_mapped(ok_button.actor);
    }
    
    destroy() {
        this.actor.destroy();
    }
}

class SortViewItem extends Card {
    constructor(applet, entry, idx) {
        super();
        
        const title = new St.Label({ y_align: Clutter.ActorAlign.CENTER, text: applet.storage.config.translations[entry.by] });
        this.left_header_box.add_child(title);
        
        const icon = (entry.direction === 'asc') ? 'cronomix-sort-ascending-symbolic' : 'cronomix-sort-descending-symbolic';
        const direction_button = new Button({ icon: icon, style_class: 'cronomix-floating-button' });
        this.header.insert_child_above(direction_button.actor, this.autohide_box);
        
        const down_arrow = new Button({ parent: this.autohide_box, icon: 'cronomix-pan-down-symbolic', style_class: 'cronomix-floating-button' });
        const up_arrow = new Button({ parent: this.autohide_box, icon: 'cronomix-pan-up-symbolic', style_class: 'cronomix-floating-button' });
        
        //
        // listen
        //
        direction_button.subscribe('left_click', () => {
            if (entry.direction === 'asc') {
                entry.direction = 'desc';
                direction_button.set_icon('cronomix-sort-descending-symbolic');
            }
            else {
                entry.direction = 'asc';
                direction_button.set_icon('cronomix-sort-ascending-symbolic');
            }
            
            applet.storage.flush();
        });
        down_arrow.subscribe('left_click', () => {
            applet.storage.modify('sort', v => {
                if (idx < v.value.length - 1) {
                    const tmp = v.value[idx + 1];
                    v.value[idx + 1] = v.value[idx];
                    v.value[idx] = tmp;
                }
            });
            
            applet.show_sort_view();
        });
        up_arrow.subscribe('left_click', () => {
            applet.storage.modify('sort', v => {
                if (idx > 0) {
                    const tmp = v.value[idx - 1];
                    v.value[idx - 1] = v.value[idx];
                    v.value[idx] = tmp;
                }
            });
            
            applet.show_sort_view();
        });
    }
}
