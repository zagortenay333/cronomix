import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import { GrabHelper } from 'resource:///org/gnome/shell/ui/grabHelper.js';
import { BoxPointer } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Misc from './misc.js';
import { Button } from './button.js';
import { ScrollBox } from './scroll.js';
import { Markup } from './markup/renderer.js';

export class Popup {
    is_open = false;
    scrollbox;
    on_close() { }
    ;
    destroy_on_close;
    boxpointer;
    
    #focus_actor;
    #grab_helper;
    
    // If @owner is destroyed, the popup gets destroyed too.
    //
    // When @focus_actor is provided the popup will not be modal.
    // The focus will held by the @focus_actor. This can be used
    // to implement an completion popup on an entry.
    //
    // TODO(GNOME_BUG): Unfortunately when @focus_actor is given,
    // then the user will not be able to interact with the popup.
    // I can't figure out how to implement this with Clutter.
    constructor(owner, focus_actor, destroy_on_close = false, arrow_side = St.Side.TOP) {
        this.destroy_on_close = destroy_on_close;
        
        //
        // boxpointer
        //
        this.boxpointer = new BoxPointer(arrow_side);
        Main.layoutManager.uiGroup.add_child(this.boxpointer);
        
        this.boxpointer.hide();
        this.boxpointer.reactive = true;
        this.boxpointer.add_style_class_name('popup-menu-boxpointer popup-menu');
        this.boxpointer.setPosition(Main.layoutManager.dummyCursor, 0);
        
        //
        // scrollbox
        //
        this.scrollbox = new ScrollBox(true);
        new Misc.CellBox(this.boxpointer.bin, this.scrollbox.actor);
        this.scrollbox.actor.add_style_class_name('cronomix-menu popup-menu-content');
        global.focus_manager.add_group(this.scrollbox.box);
        this.scrollbox.box.reactive = true;
        
        //
        // grab helper
        //
        this.#focus_actor = focus_actor ?? this.boxpointer;
        this.#grab_helper = new GrabHelper(this.#focus_actor);
        
        //
        // listen
        //
        Misc.run_when_mapped(this.boxpointer, () => Misc.adjust_width(this.boxpointer, this.boxpointer.bin), false);
        this.boxpointer.connect('notify::allocation', () => Misc.adjust_width(this.boxpointer, this.boxpointer.bin));
        owner?.connect('destroy', () => this.destroy());
        this.scrollbox.box.connect('key-press-event', (_, event) => {
            if (global.focus_manager.navigate_from_event(event))
                return Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        });
    }
    
    open_at_widget(at) {
        if (at instanceof Button) {
            if (!at.actor.is_mapped())
                return;
            
            let destroyed = false;
            at.actor.connect('destroy', () => destroyed = true);
            
            at.checked = true;
            
            const old_on_close = this.on_close;
            this.on_close = () => {
                if (!destroyed)
                    at.checked = false;
                old_on_close?.();
            };
            
            const b = Misc.get_transformed_allocation(at.actor);
            this.open(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        }
        else {
            if (!at.is_mapped())
                return;
            const b = Misc.get_transformed_allocation(at);
            this.open(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        }
    }
    
    open(x, y, anchor_width, anchor_height) {
        Main.layoutManager.setDummyCursorGeometry(x, y, anchor_width, anchor_height);
        Main.layoutManager.uiGroup.set_child_above_sibling(this.boxpointer, null);
        
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const area = Misc.get_monitor_work_area(this.scrollbox.actor);
        const maxw = Math.max(x, area.width - x);
        const maxh = Math.max(y, area.height - y);
        
        this.boxpointer.style = `max-width: ${(maxw - 6) / scale}px; max-height: ${(maxh - 6) / scale}px`;
        this.boxpointer.updateArrowSide(y === maxh ? St.Side.BOTTOM : St.Side.TOP);
        
        this.#grab_helper.grab({ actor: this.#focus_actor, onUngrab: () => this.close(false) });
        this.is_open = true;
        this.boxpointer.open(1 /* PopupAnimation.SLIDE */);
    }
    
    close(do_ungrab = true) {
        if (this.is_open) {
            if (do_ungrab)
                this.#grab_helper.ungrab({ actor: this.#focus_actor });
            this.is_open = false;
            this.boxpointer.close(1 /* PopupAnimation.SLIDE */, () => {
                this.on_close?.();
                if (this.destroy_on_close)
                    this.boxpointer.destroy();
            });
        }
    }
    
    destroy() {
        this.destroy_on_close = true;
        this.close();
    }
}

export function show_transient_popup(at) {
    const popup = new Popup(at instanceof Button ? at.actor : at, undefined, true);
    popup.open_at_widget(at);
    return popup;
}

export function show_error_popup(at, msg) {
    const popup = show_transient_popup(at);
    const markup = new Markup(msg);
    popup.scrollbox.box.add_child(markup.actor);
}

export function show_info_popup(at, msg) {
    const popup = show_transient_popup(at);
    const markup = new Markup(msg);
    popup.scrollbox.box.add_child(markup.actor);
}

export function show_confirm_popup(at, on_confirm) {
    const popup = show_transient_popup(at);
    const button = new Button({ parent: popup.scrollbox.box, label: _('Confirm') });
    button.actor.grab_key_focus();
    button.subscribe('left_click', () => {
        const prev = popup.on_close;
        popup.on_close = () => { prev?.(); on_confirm(); };
        popup.close();
    });
}
