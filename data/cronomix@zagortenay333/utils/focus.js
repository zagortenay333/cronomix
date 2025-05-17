import Clutter from 'gi://Clutter';

import * as Misc from './misc.js';
import { PubSub } from './pubsub.js';

export class FocusTracker extends PubSub {
    has_focus = false;
    has_pointer = false;
    
    #sid = 0;
    #widget;
    
    constructor(widget) {
        super();
        this.#widget = widget;
        
        // TODO(GNOME_BUG): My understanding is that if an object gets destroyed
        // no signals other than 'destroy' should be emitted on it, but this
        // doesn't appear to be the case here. The 'leave-event' handler
        // gets triggered after the 'destroy' signal which causes it to
        // access the now deallocated C object. We work around this by
        // manually tracking whether we are destroyed.
        let destroyed = false;
        
        this.#widget.connect('destroy', () => { destroyed = true; this.disconnect(); });
        this.#widget.connect('enter-event', () => { if (!destroyed && this.#check_pointer())
            this.publish('pointer_enter', true); });
        this.#widget.connect('leave-event', () => { if (!destroyed && !this.#check_pointer())
            this.publish('pointer_leave', this.has_focus); });
        this.#widget.connect('notify::mapped', () => {
            if (destroyed) {
                // nothing
            }
            if (this.#widget.is_mapped()) {
                if (!this.#sid)
                    this.#sid = global.stage.connect('notify::key-focus', () => this.#check_focus());
            }
            else {
                this.disconnect();
            }
        });
    }
    
    disconnect() {
        if (this.#sid) {
            global.stage.disconnect(this.#sid);
            this.#sid = 0;
        }
    }
    
    #check_focus() {
        const f = global.stage.get_key_focus();
        
        if (f && this.#widget.contains(f)) {
            if (!this.has_focus) {
                this.has_focus = true;
                this.publish('focus_enter', true);
            }
        }
        else if (this.has_focus) {
            this.has_focus = false;
            this.publish('focus_leave', this.has_pointer);
        }
    }
    
    #check_pointer() {
        if (!this.#widget.is_mapped())
            return false;
        
        const [x, y] = global.get_pointer();
        const w = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
        
        if (w && !this.#widget.contains(w)) {
            this.has_pointer = false;
        }
        else {
            const a = Misc.get_transformed_allocation(this.#widget);
            this.has_pointer = (x > a.x1) && (x < a.x2) && (y > a.y1) && (y < a.y2);
        }
        
        return this.has_pointer;
    }
}
