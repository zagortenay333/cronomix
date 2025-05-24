import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Cronomix } from './../extension.js';
import * as Misc from './../utils/misc.js';
import { Storage } from './../utils/storage.js';
import { Button } from './../utils/button.js';
import { Applet, PanelPosition, PanelPositionTr } from './applet.js';

export class FlashcardsApplet extends Applet {
    storage = new Storage({
        file: '~/.config/cronomix/alarms.json',

        values: {
            panel_position: { tag: 'enum',   value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            open:           { tag: 'keymap', value: null },
        },

        groups: [
            ['panel_position'],
            ['open'],
        ],

        translations: {
            panel_position: _('Panel position'),
            open: _('Open'),
            ...PanelPositionTr,
        }
    });

    #current_view: null | { destroy: () => void } = null;

    constructor (ext: Cronomix) {
        super(ext, 'flashcards');

        this.storage.init_keymap({
            open: () => { this.panel_item.menu.open(); },
        });

        this.set_panel_position(this.storage.read.panel_position.value);
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.show_main_view();
    }

    destroy () {
        this.storage.destroy();
        super.destroy();
    }

    show_main_view () {
        this.#current_view?.destroy();
        const view = new MainView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_settings () {
        this.#current_view?.destroy();
        const view = this.storage.render(() => this.show_main_view());
        this.#current_view = { destroy: () => view.destroy() };
        this.menu.add_child(view);
    }
}

class MainView {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });

        const header = new St.BoxLayout();
        this.actor.add_child(header);

        const add_deck_button = new Button({ parent: header, icon: 'cronomix-plus-symbolic', label: _('Add Deck') });
        header.add_child(new St.BoxLayout({ x_expand: true }));
        const storage_button = new Button({ parent: header, icon: 'cronomix-wrench-symbolic' });
        Misc.focus_when_mapped(add_deck_button.actor);
        storage_button.subscribe('left_click', () => applet.show_settings());
    }

    destroy () {
        this.actor.destroy();
    }
}
