const Lang = imports.lang;
const Main           = imports.ui.main;

const SignalManager = new Lang.Class({
    Name: 'Timepp.SignalManager',

    _init: function () {
        this.signals = [];
    },

    clear: function () {
        this.disconnect_all();
        this.signals = [];
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

    disconnect: function (id) {
        let i = this.signals.length;

        while (i--) {
            if (this.signals[i].id === id) {
                this.signals[i].obj.disconnect(id);
                this.signals[i].id = null;
                break;
            }
        }
    },

    connect_all: function () {
        let i = this.signals.length;

        while (i--) {
            if (! this.signals[i].id) {
                this.signals[i].id =
                    this.signals[i].obj.connect(this.signals[i].sig_name,
                                                this.signals[i].callback);
            }
        }
    },

    disconnect_all: function () {
        let i = this.signals.length;

        while (i--) {
            if (this.signals[i]) {
                this.signals[i].obj.disconnect(this.signals[i].id);
                this.signals[i].id = null;
            }
        }
    },
});
