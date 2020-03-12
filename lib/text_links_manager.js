const Meta = imports.gi.Meta;



const ME = imports.misc.extensionUtils.getCurrentExtension();


// NOTE: Small dep on another lib
// NOTE: Small dep on another lib
// NOTE: Small dep on another lib
// NOTE: Small dep on another lib
const MISC = ME.imports.lib.misc_utils;


// =====================================================================
// @@@ Text Links Manager
// =====================================================================
var TextLinksManager = class TextLinksManager {
    constructor () {
        // @key: St.Label actor
        // @val: Map
        //     @key: regex pattern
        //     @val (called when token is clicked)
        this.label_actors = new Map();
    }

    // @label_actor: St.Label
    // @regex: Map
    //     @key: regex pattern
    //     @val (called when token is clicked)
    //
    // If a clicked word matches a regex, then the corresponding callback is
    // executed.
    add_label_actor (label_actor, regex) {
        label_actor.reactive = true;

        let info = {
            sig_ids        : [],
            regex          : regex,
            selected_token : '',
            callback       : () => null,
        };

        this.label_actors.set(label_actor, info);

        info.sig_ids.push(label_actor.connect('button-press-event', () => {
            if (info.selected_token) info.callback(info.selected_token);
        }));
        info.sig_ids.push(label_actor.connect('leave-event', () => {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        }));
        info.sig_ids.push(label_actor.connect('motion-event', (label_actor, event) => {
            this._find_keyword(label_actor, event);
        }));

        label_actor.connect('destroy', () => {
            this.remove_label_actor(label_actor);
        });
    }

    // @label_actor: St.Label
    remove_label_actor (label_actor) {
        for (let id of this.label_actors.get(label_actor).sig_ids) {
            label_actor.disconnect(id);
        }

        this.label_actors.delete(label_actor);
    }

    remove_all () {
        for (let [label_actor,] of this.label_actors) {
            this.remove_label_actor(label_actor);
        }
    }

    _find_keyword (label_actor, event) {
        let info = this.label_actors.get(label_actor);

        let [x, y] = event.get_coords();
        [, x, y]   = label_actor.transform_stage_point(x, y);
        let pos    = label_actor.clutter_text.coords_to_position(x, y);

        if (pos === label_actor.text.length) {
            info.selected_token = null;
            return;
        }

        let words = MISC.split_on_whitespace(label_actor.get_text());

        let i       = 0;
        let abs_idx = 0;

        for (; i < words.length; i++) {
            abs_idx += words[i].length;
            if (pos < abs_idx) break;
        }

        if (i >= words.length) {
            info.selected_token = null;
        } else {
            for (let [reg, callback] of info.regex) {
                if (reg.test(words[i])) {
                    info.selected_token = words[i];
                    info.callback       = callback;
                    MISC.global_wrapper.display.set_cursor(Meta.Cursor.POINTING_HAND);

                    return;
                }
            }
        }

        MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
    }
}
