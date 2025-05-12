import St from 'gi://St';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import { Switch } from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Misc from './misc.js';
import { PubSub } from './pubsub.js';

export class ButtonBox {
    actor: St.BoxLayout;

    constructor (parent?: St.Widget, homogeneous = true) {
        this.actor = new St.BoxLayout({ style_class: 'cronomix-button-box' });
        parent?.add_child(this.actor);
        this.actor.layout_manager.homogeneous = homogeneous;
    }

    add (params: ConstructorParameters<typeof Button>[0] = {}): Button {
        params.parent = this.actor;
        return new Button(params);
    }
}

export type ButtonEvents = {
    scroll:       -1|1;
    left_click:   null;
    middle_click: null;
    right_click:  null;
}

export class Button extends PubSub<ButtonEvents> {
    actor:  St.BoxLayout;
    icon?:  St.Icon|null;
    label?: St.Label|null;

    #checked?: boolean;

    constructor ({
        parent      = null as St.Widget|null,
        icon        = '',
        label       = '',
        style_class = '',
        wide        = false,
        centered    = false,
    } = {}) {
        super();

        this.actor = new St.BoxLayout({ reactive: true, can_focus: true, track_hover: true, style_class: 'cronomix-button' });
        parent?.add_child(this.actor);

        this.actor.x_expand = wide;
        if (centered) this.actor.x_align = Clutter.ActorAlign.CENTER;
        if (style_class) this.actor.add_style_class_name(style_class);
        if (icon) this.set_icon(icon);
        if (label) this.set_label(label);

        this.actor.connect('destroy', () => this.unsubscribe_all());
        this.actor.connect('scroll-event', (_:unknown, event: Clutter.Event) => this.#on_mouse_scroll(event));
        this.actor.connect('key-release-event', (_:unknown, event: Clutter.Event) => this.#on_key_release(event));
        this.actor.connect('button-release-event', (_:unknown, event: Clutter.Event) => this.#on_mouse_release(event));
        this.actor.connect('touch_event', () => { if (Meta.is_wayland_compositor()) this.publish('left_click', null); });
    }

    set_icon (icon: string) {
        if (icon === '') {
            this.icon?.destroy();
            this.icon = null;
        } else if (this.icon) {
            this.icon.gicon = Misc.get_icon(icon);
        } else {
            this.icon = new St.Icon({ gicon: Misc.get_icon(icon) });
            this.actor.insert_child_at_index(this.icon, 0);
        }
    }

    set_label (label: string) {
        if (label === '') {
            this.label?.destroy();
            this.label = null;
        } else if (this.label) {
            this.label.set_text(label);
        } else {
            this.label = new St.Label({ x_expand: true, text: label, y_align: Clutter.ActorAlign.CENTER });
            this.actor.add_child(this.label);
        }
    }

    get checked (): boolean {
        return !!this.#checked;
    }

    set checked (value: boolean) {
        if (value) {
            this.actor.add_style_pseudo_class('checked');
        } else {
            this.actor.remove_style_pseudo_class('checked');
        }

        this.#checked = value;
    }

    #on_key_release (event: Clutter.Event) {
        const s = event.get_key_symbol();

        if (s === Clutter.KEY_Return || s === Clutter.KEY_KP_Enter) {
            if (this.#checked !== undefined) this.checked = !this.checked;
            this.publish('left_click', null);
        }
    }

    #on_mouse_release (event: Clutter.Event) {
        if (this.#checked !== undefined) this.checked = !this.checked;

        switch (event.get_button()) {
        case Clutter.BUTTON_PRIMARY:   this.publish('left_click', null); break;
        case Clutter.BUTTON_MIDDLE:    this.publish('middle_click', null); break;
        case Clutter.BUTTON_SECONDARY: this.publish('right_click', null); break;
        }
    }

    #on_mouse_scroll (event: Clutter.Event) {
        const direction = event.get_scroll_direction();

        if (direction === Clutter.ScrollDirection.UP) {
            this.publish('scroll', -1);
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            this.publish('scroll', 1);
        }
    }
}

export class SwitchButton extends Button {
    constructor ({
        parent      = null as St.Widget|null,
        label       = '',
        style_class = '',
        checked     = false,
    } = {}) {
        super({ parent, label, style_class });
        const s = new Switch(checked);
        s.reactive = false;
        this.actor.add_child(s);
        this.actor.add_style_class_name('cronomix-toggle');
        this.checked = checked;
        this.subscribe('left_click', () => s.state = this.checked);
    }
}

export class CheckBox extends Button {
    constructor ({
        parent      = null as St.Widget|null,
        label       = '',
        style_class = '',
        checked     = false,
    } = {}) {
        super({ parent, label, style_class });
        const bin = new St.Bin();
        this.actor.add_child(bin);
        bin.set_child(new St.Icon({ icon_name: 'check-symbolic' }));
        this.actor.add_style_class_name('cronomix-checkbox check-box');
        this.checked = checked;
    }
}
