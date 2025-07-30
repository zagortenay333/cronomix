import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as T from './../utils/time.js';
import * as Misc from './../utils/misc.js';
import { Storage } from './../utils/storage.js';
import { ScrollBox } from './../utils/scroll.js';
import { ext, Cronomix } from './../extension.js';
import { Markup } from './../utils/markup/renderer.js';
import { EditorView } from './../utils/markup/editor.js';
import { show_confirm_popup } from './../utils/popup.js';
import { Button, ButtonBox, SwitchButton } from './../utils/button.js';
import { Applet, PanelPosition, PanelPositionTr } from './applet.js';
import { DaySelection, DayPicker, IntPicker, TimePicker } from './../utils/pickers.js';

type Alarm = {
    msg: string;
    time: T.Minutes;
    snooze: T.Minutes;
    enabled: boolean;
    days: DaySelection;
}

export class AlarmApplet extends Applet {
    storage = new Storage({
        file: '~/.config/cronomix/alarms.json',

        values: {
            panel_position: { tag: 'enum',    value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            notif_sound:    { tag: 'file',    value: ext.path + '/data/sounds/beeps.ogg', start: ext.path + '/data/sounds/' },
            open:           { tag: 'keymap',  value: null },
            add_alarm:      { tag: 'keymap',  value: null },
            alarms:         { tag: 'custom',  value: Array<Alarm>() },
        },

        groups: [
            ['panel_position', 'notif_sound'],
            ['open', 'add_alarm'],
        ],

        translations: {
            panel_position: _('Panel position'),
            notif_sound: _('Notification sound'),
            open: _('Open'),
            add_alarm: _('Add Alarm'),
            ...PanelPositionTr,
        }
    });

    wallclock: T.WallClock;

    #snoozed = new Map<T.Minutes, Alarm[]>();
    #current_view: null | { destroy: () => void } = null;

    constructor (ext: Cronomix) {
        super(ext, 'alarm');

        this.storage.init_keymap({
            open:      () => { this.panel_item.menu.open(); },
            add_alarm: () => { this.panel_item.menu.open(); this.show_editor(); }
        });

        this.set_panel_position(this.storage.read.panel_position.value);
        this.wallclock = new T.WallClock();
        this.wallclock.subscribe('tic', (time) => this.#tic(time));
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.show_main_view();
    }

    destroy () {
        this.wallclock.destroy();
        this.storage.destroy();
        super.destroy();
    }

    #tic (time: T.Minutes) {
        const day = T.get_day();

        for (const alarm of this.storage.read.alarms.value) {
            if (alarm.enabled && alarm.time === time && alarm.days[day]) {
                this.show_notification(alarm);
            }
        }

        const snoozed = this.#snoozed.get(time) ?? [];
        for (const alarm of snoozed) this.show_notification(alarm);
        this.#snoozed.delete(time);
    }

    delete_alarm (alarm: Alarm) {
        this.storage.modify('alarms', v => Misc.array_remove(v.value, alarm));
        const snoozed = this.#snoozed.get(alarm.time);
        if (snoozed) Misc.array_remove(snoozed, alarm);
    }

    add_alarm (alarm: Alarm) {
        this.storage.modify('alarms', v => v.value.push(alarm));
    }

    snooze_alarm (alarm: Alarm) {
        const time = (alarm.time + alarm.snooze) % (24*60);
        const list = this.#snoozed.get(time) ?? [];
        list.push(alarm);
        this.#snoozed.set(time, list);
    }

    toggle_alarm (alarm: Alarm) {
        alarm.enabled = !alarm.enabled;

        if (! alarm.enabled) {
            const snoozed = this.#snoozed.get(alarm.time);
            if (snoozed) Misc.array_remove(snoozed, alarm);
        }

        this.storage.flush();
    }

    show_main_view () {
        this.#current_view?.destroy();
        const view = new MainView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_notification (alarm: Alarm) {
        if (this.panel_item.visible) this.panel_item.menu.open();
        else                         Main.notify(_("Alarm."));

        let view: NotificationView;

        if (this.#current_view instanceof NotificationView) {
            view = this.#current_view;
        } else {
            this.#current_view?.destroy();
            view = new NotificationView(this);
            this.#current_view = view;
            this.menu.add_child(view.actor.actor);
        }

        view.push(alarm);
        this.sound_cancel = Misc.play_sound(this.storage.read.notif_sound.value);
    }

    show_settings () {
        this.#current_view?.destroy();
        const view = this.storage.render(() => this.show_main_view());
        this.#current_view = { destroy: () => view.destroy() };
        this.menu.add_child(view);
    }

    show_editor (alarm?: Alarm) {
        this.#current_view?.destroy();
        const view = new AlarmEditor(this, alarm);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
}

class MainView {
    actor: St.BoxLayout;

    constructor (applet: AlarmApplet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });

        const header = new St.BoxLayout();
        this.actor.add_child(header);

        const add_alarm_button = new Button({ parent: header, icon: 'cronomix-plus-symbolic', label: _('Add Alarm') });
        header.add_child(new St.BoxLayout({ x_expand: true }));
        const storage_button = new Button({ parent: header, icon: 'cronomix-wrench-symbolic' });

        Misc.focus_when_mapped(add_alarm_button.actor);

        const alarms = applet.storage.read.alarms.value;

        if (alarms.length) {
            const scrollbox = new ScrollBox();
            this.actor.add_child(scrollbox.actor);
            for (const alarm of alarms) scrollbox.box.add_child((new AlarmCard(applet, alarm)).actor);
        }

        add_alarm_button.subscribe('left_click', () => applet.show_editor());
        storage_button.subscribe('left_click', () => applet.show_settings());
    }

    destroy () {
        this.actor.destroy();
    }
}

class AlarmCard extends Misc.Card {
    alarm: Alarm;

    constructor (applet: AlarmApplet, alarm: Alarm) {
        super();

        this.alarm = alarm;

        this.actor.style = 'min-width: 200px;';

        const time = new T.Time(alarm.time * 60000).fmt_hm()
        const time_label = new St.Label({ text: time, y_align: Clutter.ActorAlign.CENTER, style: 'font-weight: bold;' });
        this.left_header_box.add_child(time_label);

        const edit_button   = new Button({ parent: this.autohide_box, icon: 'cronomix-edit-symbolic', style_class: 'cronomix-floating-button' });
        const delete_button = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic', style_class: 'cronomix-floating-button' });
        const toggle        = new SwitchButton({ parent: this.header, checked: alarm.enabled });

        if (alarm.msg) this.actor.add_child((new Markup(alarm.msg)).actor);

        toggle.subscribe('left_click', () => applet.toggle_alarm(alarm));
        edit_button.subscribe('left_click', () => applet.show_editor(alarm));
        delete_button.subscribe('left_click', () => {
            show_confirm_popup(delete_button, () => {
                this.actor.destroy();
                applet.delete_alarm(alarm);
            });
        });
    }
}

class AlarmEditor extends EditorView {
    constructor (applet: AlarmApplet, alarm?: Alarm) {
        super();

        Misc.focus_when_mapped(this.main_view.entry.entry);

        //
        // configs
        //
        const day_picker = new DayPicker(alarm?.days);
        this.main_view.left_box.add_child(day_picker.actor);

        const group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        this.main_view.left_box.add_child(group);

        const time = new T.Time(60000 * (alarm?.time ?? applet.wallclock.time));
        const time_picker = new TimePicker(time, true);
        new Misc.Row(_('Time'), time_picker.actor, group);

        const snooze_picker = new IntPicker(1, 60, 5);
        if (alarm) snooze_picker.set_value(alarm.snooze);
        new Misc.Row(_('Snooze n minutes'), snooze_picker.actor, group);

        //
        // buttons
        //
        const button_box    = new ButtonBox(this.main_view.left_box);
        const ok_button     = button_box.add({ wide: true, label: _('Ok') });
        const cancel_button = button_box.add({ wide: true, label: _('Cancel') });

        //
        // listen
        //
        cancel_button.subscribe('left_click', () => applet.show_main_view());
        ok_button.subscribe('left_click', () => {
            if (alarm) applet.delete_alarm(alarm);

            const time   = time_picker.get_time();
            const snooze = snooze_picker.get_value();

            applet.add_alarm({
                days:    day_picker.selection,
                msg:     this.main_view.entry.entry.text,
                time:    time.total / (60*1000),
                snooze:  snooze,
                enabled: alarm?.enabled ?? true,
            });

            applet.show_main_view();
        });

        //
        // finally
        //
        this.main_view.entry.entry.set_text(alarm?.msg ?? '');
    }

    destroy () {
        this.actor.destroy();
    }
}

class NotificationView {
    actor: ScrollBox;
    #applet: AlarmApplet;

    constructor (applet: AlarmApplet) {
        this.#applet = applet;
        this.actor = new ScrollBox();
    }

    destroy () {
        this.#applet.sound_cancel?.cancel();
        this.actor.actor.destroy();
    }

    push (alarm: Alarm) {
        const n = new Notification(alarm);
        this.actor.box.add_child(n.actor);

        n.snooze_button.subscribe('left_click', () => { this.#applet.snooze_alarm(alarm); n.actor.destroy(); this.#applet.show_main_view(); });
        n.dismiss_button.subscribe('left_click', () => {
            if (this.actor.box.get_n_children() === 1) {
                this.#applet.show_main_view();
            } else {
                n.actor.destroy();
            }
        });
    }
}

class Notification {
    actor: St.BoxLayout;
    snooze_button: Button;
    dismiss_button: Button;

    constructor (alarm: Alarm) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-box' });

        this.actor.add_child(new Markup(alarm.msg || _('Alarm')).actor);

        const button_box    = new ButtonBox(this.actor);
        this.snooze_button  = button_box.add({ wide: true, label: _('Snooze') });
        this.dismiss_button = button_box.add({ wide: true, label: _('Dismiss') });
    }
}
