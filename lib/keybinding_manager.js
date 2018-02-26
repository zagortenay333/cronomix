const Meta  = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Lang  = imports.lang;
const Main  = imports.ui.main;

// =====================================================================
// @@@ KeybindingManager
//
// @settings: the extension settings object
// =====================================================================
var KeybindingManager = new Lang.Class({
    Name: 'Timepp.KeybindingManager',

    _init: function (settings) {
        this.settings = settings;
        this.key_ids  = new Set();
    },

    add: function (id, callback) {
        this.key_ids.add(id);

        Main.wm.addKeybinding(
            id,
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            callback
        );
    },

    clear: function () {
        for (let id of this.key_ids) Main.wm.removeKeybinding(id);
        this.key_ids.clear();
    },
});
