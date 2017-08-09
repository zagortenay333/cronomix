const Meta  = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Lang  = imports.lang;
const Main  = imports.ui.main;

const KeybindingManager = new Lang.Class({
    Name: 'Timepp.KeybindingManager',

    _init: function (settings) {
        this.settings  = settings;
        this.shortcuts = new Map();
        this.signals   = new Map();
        this.enabled   = false;
    },

    register: function (id, callback) {
        this.shortcuts.set(id, callback);
    },

    toggle: function () {
        if (this.enabled) this.disable_all();
        else              this.enable_all();
    },

    enable_all: function () {
        if (this.enabled) return;

        this.enabled = true;

        for (let [id, callback] of this.shortcuts.entries()) {
            this._enable(id, callback);

            this.signals.set(
                id,
                this.settings.connect('changed::' + id, () => {
                    Main.wm.removeKeybinding(id);
                    this._enable(id, callback);
                })
            );
        }
    },

    disable_all: function () {
        if (!this.enabled) return;

        this.enabled = false;

        for (let id of this.shortcuts.keys()) {
            Main.wm.removeKeybinding(id);
            this.settings.disconnect(this.signals.get(id));
        }

        this.signals.clear();
    },

    _enable: function (id, callback) {
        if (!this.enabled) return;

        Main.wm.addKeybinding(
            id,
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            callback
        );
    },
});
