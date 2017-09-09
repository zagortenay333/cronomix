const Clutter = imports.gi.Clutter;
const Lang    = imports.lang;


// =====================================================================
// Signal Manager
// =====================================================================
var SignalManager = new Lang.Class({
    Name: 'Timepp.SignalManager',

    _init: function () {
        this.signals = [];
    },

    clear: function () {
        this.disconnect_all();
        this.signals = [];
    },

    clear_obj: function (obj) {
        this.disconnect_obj(obj);

        for (let i = 0, len = this.signals.length; i < len; i++) {
            if (this.signals[i].obj === obj) {
                this.signals.slice(i, 1);
                len--; i--;
            }
        }
    },

    connect_press: function (obj, callback) {
        let on_release = true;

        this.connect(obj, 'button-press-event', (_, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                on_release = false;
                callback();
            }
        });
        this.connect(obj, 'button-release-event', (_, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                if (on_release) callback();
                else            on_release = true;
            }
        });
        this.connect(obj, 'key-release-event', (_, event) => {
            if (event.get_key_symbol() === Clutter.Return) callback();
        });

        obj.connect('destroy', () => {
            this.clear_obj(obj);
        });
    },

    connect: function (obj, sig_name, callback) {
        let id = obj.connect(sig_name, callback);

        this.signals.push({
            obj      : obj,
            sig_name : sig_name,
            callback : callback,
            id       : id,
        });

        return id;
    },

    disconnect_obj: function (obj) {
        for (let it of this.signals) {
            if (it.obj === obj) {
                it.obj.disconnect(it.id);
                it.id = null;
            }
        }
    },

    disconnect: function (id) {
        for (let it of this.signals) {
            if (it.id === id) {
                it.obj.disconnect(id);
                it.id = null;
                break;
            }
        }
    },

    connect_all: function () {
        for (let it of this.signals) {
            if (! it.id) {
                it.id = it.obj.connect(it.sig_name, it.callback);
            }
        }
    },

    disconnect_all: function () {
        for (let it of this.signals) {
            if (it.id) {
                it.obj.disconnect(it.id);
                it.id = null;
            }
        }
    },
});
