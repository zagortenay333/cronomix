const Meta = imports.gi.Meta;
const Lang = imports.lang;

const ME = imports.misc.extensionUtils.getCurrentExtension();

// NOTE: Small dep on another lib
const MISC_UTILS = ME.imports.lib.misc_utils;



// =====================================================================
// @@@ Text Links Manager
// =====================================================================
var TextLinksManager = new Lang.Class({
    Name: 'Timepp.TextLinksManager',

    _init: function () {
        // @key: St.Label actor
        // @val: Map
        //     @key: regex pattern
        //     @val: function (called when token is clicked)
        this.label_actors = new Map();
    },

    // @label_actor: St.Label
    // @regex: Map
    //     @key: regex pattern
    //     @val: function (called when token is clicked)
    //
    // If a clicked word matches a regex, then the corresponding callback is
    // executed.
    add_label_actor: function (label_actor, regex) {
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
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        }));
        info.sig_ids.push(label_actor.connect('motion-event', (label_actor, event) => {
            this._find_keyword(label_actor, event);
        }));

        label_actor.connect('destroy', () => {
            this.remove_label_actor(label_actor);
        });
    },

    // @label_actor: St.Label
    remove_label_actor: function (label_actor) {
        for (let id of this.label_actors.get(label_actor).sig_ids) {
            label_actor.disconnect(id);
        }

        this.label_actors.delete(label_actor);
    },

    remove_all: function () {
        for (let [label_actor,] of this.label_actors) {
            this.remove_label_actor(label_actor);
        }
    },

    _find_keyword: function (label_actor, event) {
        let info = this.label_actors.get(label_actor);

        let [x, y] = event.get_coords();
        [, x, y]   = label_actor.transform_stage_point(x, y);
        let pos    = label_actor.clutter_text.coords_to_position(x, y);

        if (pos === label_actor.text.length) {
            info.selected_token = null;
            return;
        }

        let words = MISC_UTILS.split_on_whitespace(label_actor.get_text());

        let i       = 0;
        let abs_idx = 0;

        for (; i < words.length; i++) {
            abs_idx += words[i].length;
            if (pos < abs_idx) break;
        }

        if (i >= words.length)  {
            info.selected_token = null;
        } else {
            for (let [reg, callback] of info.regex) {
                if (reg.test(words[i])) {
                    info.selected_token = words[i];
                    info.callback       = callback;
                    global.screen.set_cursor(Meta.Cursor.POINTING_HAND);

                    return;
                }
            }
        }

        global.screen.set_cursor(Meta.Cursor.DEFAULT);
    },
});
