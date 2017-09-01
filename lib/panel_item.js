const St      = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Lang    = imports.lang;
const Signals = imports.signals;


// =====================================================================
// @@@ Panel Item
//
// @menu: the popup menu
//
// @signals:
//     'left-click'
//     'middle-click'
//     'right-click'
// =====================================================================
var PanelItem = new Lang.Class({
    Name: 'Timepp.PanelItem',

    _init: function (menu) {
        this.menu = menu;

        this._mode = 'icon_text'; // one of 'icon', 'text', 'icon_text'

        //
        // draw
        //
        this.actor = new St.Button({ can_focus: true, style_class: 'panel-button' });

        this.box_content = new St.BoxLayout({ style_class: 'panel-button-content' });
        this.actor.add_actor(this.box_content);

        this.icon = new St.Icon({ style_class: 'system-status-icon' });
        this.box_content.add_actor(this.icon);

        this.label = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER });
        this.box_content.add_actor(this.label);


        //
        // listen
        //
        this.actor.connect('button-press-event', Lang.bind(this, function(actor, event) {
            let btn = event.get_button();

            switch (btn) {
                case Clutter.BUTTON_PRIMARY:
                    this.emit('left-click');
                    return Clutter.EVENT_STOP;

                case Clutter.BUTTON_MIDDLE:
                    this.emit('middle-click');
                    return Clutter.EVENT_STOP;

                case Clutter.BUTTON_SECONDARY:
                    this.emit('right-click');
                    return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }));
    },

    _update: function () {
        switch (this._mode) {
            case 'icon':
                this.icon.show();
                this.label.hide();
                break;

            case 'text':
                this.icon.hide();
                this.label.show();
                break;

            case 'icon_text':
                this.icon.show();
                this.label.show();
        }
    },

    set_mode: function (mode) {
        this._mode = mode;
        this._update();
    },

    set_label: function (str) {
        this.label.text = str;

        if (this._mode !== 'icon') this.label.show();
        else this.label.hide();
    },
});
Signals.addSignalMethods(PanelItem.prototype);
