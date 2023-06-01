import * as St from 'imports.gi.St';
import * as Main from 'imports.ui.main';
import * as Clutter from 'imports.gi.Clutter';
import { Button as PanelButton } from 'imports.ui.panelMenu';

import * as Fs from 'utils/fs';
import { _ } from 'utils/misc';
import * as Ext from 'extension';
import * as Misc from 'utils/misc';
import { PubSub } from 'utils/pubsub';
import { Button } from 'utils/button';
import { Extension } from 'extension';

export enum PanelPosition {
    LEFT   = 'left',
    CENTER = 'center',
    RIGHT  = 'right',
}

export const PanelPositionTr = {
    'left':   _('Left'),
    'center': _('Center'),
    'right':  _('Right'),
}

export class Applet <E = {}> extends PubSub<E> {
    id: string;
    ext: Extension;
    menu: St.BoxLayout;
    panel_icon: St.Icon;
    panel_label: St.Label;
    panel_item: PanelButton;

    constructor (ext: Extension, id: string) {
        super();

        this.id = id;
        this.ext = ext;

        //
        // panel button
        //
        this.panel_item = new PanelButton(0.5, `cronomix-${id}-applet`);
        this.panel_item.add_style_class_name('cronomix-panel-button');

        const box = new St.BoxLayout();
        this.panel_item.add_actor(box);

        this.panel_icon = new St.Icon({ style_class: 'system-status-icon' });
        box.add_actor(this.panel_icon);

        this.panel_label = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER });
        box.add_actor(this.panel_label);

        this.set_panel_icon(`cronomix-${id}-symbolic`);

        //
        // menu
        //
        const wrapper = new Misc.CellBox(this.panel_item.menu.box);

        this.menu = new St.BoxLayout({ vertical: true });
        wrapper.cell.add_actor(this.menu);

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
                        wrapper.cell.add_actor(context_menu.actor);
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
        this.panel_item.destroy();
    }
}

export class ContextMenu {
    actor: St.BoxLayout;

    constructor (ext: Extension) {
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true });

        const items_box = new St.BoxLayout({ vertical: true });
        this.actor.add_actor(items_box);

        const settings_button = new Button({ parent: items_box, icon: 'cronomix-wrench-symbolic', label: _('Settings'), style_class: 'cronomix-menu-button' });
        const website_button  = new Button({ parent: items_box, icon: 'cronomix-link-symbolic', label: _('Website'), style_class: 'cronomix-menu-button' });

        website_button.subscribe('left_click', () => Fs.open_web_uri_in_default_app(Misc.Me.metadata.url));
        settings_button.subscribe('left_click', () => {
            let settings_view: St.Widget;

            const done_fn = () => {
                settings_view.destroy();
                items_box.show();
            };

            const check_fn = () => {
                let n_enabled = 0;

                for (const [applet_name] of Ext.applets) {
                    const enabled = ext.storage.read[applet_name].value;
                    if (enabled) n_enabled++;
                }

                return n_enabled ? '' : 'At least one applet must be enabled.';
            };

            settings_view = ext.storage.render(done_fn, check_fn);
            this.actor.add_actor(settings_view);
            items_box.hide();
        });
    }
}
