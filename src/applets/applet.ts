import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Button as PanelButton } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './../utils/fs.js';
import * as Misc from './../utils/misc.js';
import { PubSub } from './../utils/pubsub.js';
import { Button } from './../utils/button.js';
import { ext as root, Cronomix, applets } from './../extension.js';

export enum PanelPosition {
    LEFT   = 'left',
    CENTER = 'center',
    RIGHT  = 'right',
}

export const PanelPositionTr = {
    get left ()   { return _('Left'); },
    get center () { return _('Center'); },
    get right ()  { return _('Right'); },
}

export class Applet <E = {}> extends PubSub<E> {
    id: string;
    ext: Cronomix;
    menu: St.BoxLayout;
    panel_icon: St.Icon;
    panel_label: St.Label;
    panel_item: PanelButton;
    sound_cancel: Gio.Cancellable | null = null;
    #session_signal_id: number;

    constructor (ext: Cronomix, id: string) {
        super();

        this.id = id;
        this.ext = ext;

        //
        // panel button
        //
        this.panel_item = new PanelButton(0.5, `cronomix-${id}-applet`);
        this.panel_item.add_style_class_name('cronomix-panel-button');

        const box = new St.BoxLayout();
        this.panel_item.add_child(box);

        this.panel_icon = new St.Icon({ style_class: 'system-status-icon' });
        box.add_child(this.panel_icon);

        this.panel_label = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.panel_label);

        this.set_panel_icon(`cronomix-${id}-symbolic`);

        //
        // menu
        //
        const wrapper = new Misc.CellBox(this.panel_item.menu.box);

        this.menu = new St.BoxLayout({ vertical: true });
        wrapper.cell.add_child(this.menu);

        this.panel_item.menu.box.add_style_class_name('cronomix-menu');
        let context_menu: ContextMenu|null = null;

        //
        // listen
        //
        this.panel_item.connect('captured-event', (_:unknown, event: Clutter.Event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                    this.menu.hide();
                    if (! context_menu) {
                        context_menu = new ContextMenu(this.ext);
                        wrapper.cell.add_child(context_menu.actor);
                    }
                } else {
                    context_menu?.actor.destroy();
                    context_menu = null;
                    this.menu.show();
                }
            }
        });
        this.panel_item.menu.connect('open-state-changed', (_:unknown, state: boolean) => {
            if (state) {
                const area = Misc.get_monitor_work_area(this.panel_item.menu.actor);
                this.panel_item.menu.actor.style = `max-width: ${area.width - 6}px; max-height: ${area.height - 6}px`;
            }
        });
        this.#session_signal_id = Main.sessionMode.connect('updated', (s: any) => {
            if (s.currentMode === 'user' || s.parentMode === 'user') {
                this.panel_item.show();
            } else if (s.currentMode === 'unlock-dialog') {
                this.panel_item.hide();
            }
        });
    }

    set_panel_position (position: PanelPosition) {
        const idx = (position === PanelPosition.RIGHT) ? 0 : -1;
        delete Main.panel.statusArea[this.id];
        Main.panel.addToStatusArea(this.id, this.panel_item, idx, position);
    }

    set_panel_icon (icon_name: string) {
        this.panel_icon.gicon = Misc.get_icon(icon_name);
    }

    set_panel_label (str: string) {
        this.panel_label.set_text(str);
    }

    destroy () {
        Main.sessionMode.disconnect(this.#session_signal_id);
        this.panel_item.destroy();
    }
}

export class ContextMenu {
    actor: St.BoxLayout;

    constructor (ext: Cronomix) {
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true });

        const items_box = new St.BoxLayout({ vertical: true });
        this.actor.add_child(items_box);

        const settings_button = new Button({ parent: items_box, icon: 'cronomix-wrench-symbolic', label: _('Settings'), style_class: 'cronomix-menu-button' });
        const website_button  = new Button({ parent: items_box, icon: 'cronomix-link-symbolic', label: _('Website'), style_class: 'cronomix-menu-button' });

        website_button.subscribe('left_click', () => Fs.open_web_uri_in_default_app(root.metadata.url));
        settings_button.subscribe('left_click', () => {
            let settings_view: St.Widget;

            const done_fn = () => {
                settings_view.destroy();
                items_box.show();
            };

            const check_fn = () => {
                let n_enabled = 0;

                for (const [applet_name] of applets) {
                    const enabled = ext.storage.read[applet_name].value;
                    if (enabled) n_enabled++;
                }

                return n_enabled ? '' : 'At least one applet must be enabled.';
            };

            settings_view = ext.storage.render(done_fn, check_fn);
            this.actor.add_child(settings_view);
            items_box.hide();
        });
    }
}
