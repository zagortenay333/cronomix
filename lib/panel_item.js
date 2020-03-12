const St      = imports.gi.St;
const Gtk     = imports.gi.Gtk;
const Clutter = imports.gi.Clutter;

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
var PanelItem = class PanelItem {
    constructor (menu) {
        this.menu = menu;
        this.mode = 'icon_text'; // one of 'icon', 'text', 'icon_text'

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
        this.actor.connect('button-press-event', (_, event) => {
            switch (event.get_button()) {
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
        });

        this.actor.connect('key-press-event', (_, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Down) {
                this.menu.actor.navigate_focus(global.stage.get_key_focus(),
                                         Gtk.DirectionType.TAB_FORWARD,
                                         true);
            }
        });
    }

    set_mode (mode) {
        this.mode = mode;

        switch (mode) {
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
    }

    set_label (str) {
        this.label.text = str;
        if (this.mode !== 'icon') this.label.show();
        else this.label.hide();
    }
}
Signals.addSignalMethods(PanelItem.prototype);
