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
//     'click'        : on mouse click
//     'middle-click' : on mouse middle click
// =====================================================================
const PanelItem = new Lang.Class({
    Name: 'Timepp.PanelItem',

    _init: function (menu) {
        this._mode = 'icon_text'; // one of 'icon', 'text', 'icon_text'

        //
        // draw
        //
        this.actor = new St.Button({ style_class: 'panel-button' });

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

            if (btn === Clutter.BUTTON_MIDDLE) {
                this.emit('middle-click');
                return Clutter.EVENT_STOP;
            }
            else if (btn === Clutter.BUTTON_PRIMARY ||
                     btn === Clutter.BUTTON_SECONDARY) {

                this.emit('click');
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }));
        menu.connect('open-state-changed', (_, open) => {
            // We only listen for when the menu closes and remove the checked
            // state from the panel item.
            // When the menu opens, the menu_toggled method will be called.
            if (! open) { this.actor.remove_style_pseudo_class('checked'); }
        });
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

    // (am_open === true) means that the section that corresponds to this
    // panel item is currently open; otherwise, it means it's not.
    menu_toggled: function (am_open) {
        if (am_open) this.actor.add_style_pseudo_class('checked');
    },

    set_mode: function(mode) {
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
