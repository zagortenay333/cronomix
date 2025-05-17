import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Misc from './../utils/misc.js';
import { Storage } from './../utils/storage.js';
import { unreachable } from './../utils/misc.js';
import { ScrollBox } from './../utils/scroll.js';
import { ext } from './../extension.js';
import { TimePicker } from './../utils/pickers.js';
import { Markup } from './../utils/markup/renderer.js';
import { EditorView } from './../utils/markup/editor.js';
import { Button, ButtonBox, CheckBox } from './../utils/button.js';
import { Time, get_time_ms } from './../utils/time.js';
import { show_confirm_popup, show_error_popup } from './../utils/popup.js';
import { Applet, PanelPosition, PanelPositionTr } from './../applets/applet.js';

class Preset {
    text = '';
    time = 5 * 60000;
}

export class TimerApplet extends Applet {
    storage = new Storage({
        file: '~/.config/cronomix/timer.json',
        
        values: {
            show_panel_label: { tag: 'boolean', value: true },
            panel_position: { tag: 'enum', value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            clock_size: { tag: 'number', value: 0, range: [0, 2000] },
            notif_sound: { tag: 'file', value: ext.path + '/data/sounds/beeps.ogg', start: ext.path + '/data/sounds/' },
            open: { tag: 'keymap', value: null },
            show_presets: { tag: 'keymap', value: null },
            current_preset: { tag: 'custom', value: -1 },
            default_preset: { tag: 'custom', value: new Preset() },
            presets: { tag: 'custom', value: Array() },
        },
        
        groups: [
            ['show_panel_label', 'panel_position', 'clock_size', 'notif_sound'],
            ['open', 'show_presets'],
        ],
        
        translations: {
            show_panel_label: _('Show time in panel'),
            panel_position: _('Panel position'),
            clock_size: _('Clock size (set to 0 for default size)'),
            notif_sound: _('Notification sound'),
            open: _('Open'),
            show_presets: _('Show presets'),
            ...PanelPositionTr,
        }
    });
    
    time;
    state;
    preset;
    
    #tic_id = 0;
    #current_view = null;
    
    constructor(ext) {
        super(ext, 'timer');
        
        this.storage.init_keymap({
            open: () => { this.panel_item.menu.open(); },
            show_presets: () => { this.panel_item.menu.open(); this.show_presets(); },
        });
        
        this.set_panel_position(this.storage.read.panel_position.value);
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.storage.subscribe('show_panel_label', ({ value }) => this.panel_label.visible = value && this.state !== 2 /* State.RESET */);
        this.reset();
        this.show_main_view();
    }
    
    destroy() {
        this.pause();
        this.storage.destroy();
        super.destroy();
    }
    
    #tic(prev) {
        const now = get_time_ms();
        prev ??= now;
        const new_time = this.time.total - (now - prev);
        
        if (new_time > 0) {
            this.time = new Time(new_time);
            this.set_panel_label(this.time.fmt_hms(true));
            this.#tic_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this.#tic(now));
            this.publish('tic', this.time);
        }
        else {
            if (this.panel_item.visible)
                this.panel_item.menu.open();
            else
                Main.notify(_("Timer elapsed."));
            this.show_timer_elapsed();
            this.reset();
        }
    }
    
    start() {
        this.state = 0 /* State.RUNNING */;
        if (this.storage.read.show_panel_label.value)
            this.panel_label.show();
        this.publish('state_update', this.state);
        this.#tic();
    }
    
    pause() {
        this.state = 1 /* State.PAUSED */;
        if (this.#tic_id) {
            GLib.source_remove(this.#tic_id);
            this.#tic_id = 0;
        }
        this.publish('state_update', this.state);
    }
    
    reset(preset_idx = this.storage.read.current_preset.value) {
        this.set_preset(preset_idx);
        this.state = 2 /* State.RESET */;
        this.panel_label.hide();
        this.time = new Time(this.preset.time);
        if (this.#tic_id) {
            GLib.source_remove(this.#tic_id);
            this.#tic_id = 0;
        }
        this.publish('state_update', this.state);
    }
    
    set_preset(preset_idx) {
        const presets = this.storage.read.presets.value;
        if (preset_idx >= presets.length)
            preset_idx = -1;
        this.preset = presets[preset_idx] ?? this.storage.read.default_preset.value;
        this.storage.modify('current_preset', x => x.value = preset_idx);
    }
    
    delete_preset(preset_idx) {
        this.storage.modify('presets', x => Misc.array_remove_idx(x.value, preset_idx));
        if (this.storage.read.current_preset.value === preset_idx)
            this.set_preset(-1);
    }
    
    show_main_view() {
        this.#current_view?.destroy();
        const view = new MainView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_settings() {
        this.#current_view?.destroy();
        const view = this.storage.render(() => this.show_main_view());
        this.#current_view = view;
        this.menu.add_child(view);
    }
    
    show_presets() {
        this.#current_view?.destroy();
        const view = new Presets(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_preset_editor(preset) {
        this.#current_view?.destroy();
        const view = new PresetEditor(this, preset);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_timer_elapsed() {
        this.#current_view?.destroy();
        const view = new TimerElapsedView(this, this.preset);
        this.#current_view = view;
        this.menu.add_child(view.actor);
        this.sound_cancel = Misc.play_sound(this.storage.read.notif_sound.value);
    }
}

class MainView {
    actor;
    
    #sid1;
    #sid2;
    #applet;
    
    constructor(applet) {
        this.#applet = applet;
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });
        
        //
        // Header
        //
        const header = new St.BoxLayout();
        this.actor.add_child(header);
        
        const time_picker = new TimePicker();
        header.add_child(time_picker.actor);
        
        const time_label = new St.Label({ style: 'font-weight: bold;', y_align: Clutter.ActorAlign.CENTER });
        const clock_size = applet.storage.read.clock_size.value;
        if (clock_size > 0)
            time_label.style += `font-family: monospace; font-size: ${clock_size}px;`;
        header.add_child(time_label);
        
        header.add_child(new St.Widget({ x_expand: true, style: 'min-width: 40px;' }));
        
        const header_buttons = new ButtonBox(header);
        const presets_button = header_buttons.add({ icon: 'cronomix-hamburger-symbolic' });
        const settings_button = header_buttons.add({ icon: 'cronomix-wrench-symbolic' });
        
        header_buttons.actor.y_align = Clutter.ActorAlign.START;
        Misc.focus_when_mapped(settings_button.actor);
        
        //
        // buttons
        //
        const button_box = new ButtonBox(this.actor);
        const start_button = button_box.add({ wide: true, label: _('Start') });
        const pause_button = button_box.add({ wide: true, label: _('Pause') });
        const reset_button = button_box.add({ wide: true, label: _('Reset') });
        
        //
        // ui update
        //
        let block_ui_update = false;
        const update_ui = (state) => {
            if (block_ui_update)
                return;
            
            time_label.set_text(applet.time.fmt_hms(true));
            
            switch (state) {
                case 0 /* State.RUNNING */:
                    pause_button.actor.grab_key_focus();
                    start_button.actor.hide();
                    reset_button.actor.show();
                    pause_button.actor.show();
                    time_label.show();
                    time_picker.actor.hide();
                    break;
                case 1 /* State.PAUSED */:
                    start_button.actor.grab_key_focus();
                    start_button.actor.show();
                    reset_button.actor.show();
                    pause_button.actor.hide();
                    time_picker.actor.hide();
                    break;
                case 2 /* State.RESET */:
                    start_button.actor.grab_key_focus();
                    start_button.actor.show();
                    reset_button.actor.hide();
                    pause_button.actor.hide();
                    time_label.hide();
                    time_picker.actor.show();
                    time_picker.set_time(new Time(applet.preset.time));
                    break;
                default:
                    unreachable(state);
            }
        };
        
        update_ui(applet.state);
        
        //
        // listen
        //
        start_button.subscribe('left_click', () => applet.start());
        pause_button.subscribe('left_click', () => applet.pause());
        reset_button.subscribe('left_click', () => applet.reset());
        settings_button.subscribe('left_click', () => applet.show_settings());
        presets_button.subscribe('left_click', () => applet.show_presets());
        this.#sid1 = applet.subscribe('tic', (time) => time_label.set_text(time.fmt_hms(true)));
        this.#sid2 = applet.subscribe('state_update', (state) => update_ui(state));
        time_picker.on_change = time => {
            if (!time)
                return;
            applet.storage.modify('default_preset', x => x.value = { text: '', time: time.total });
            block_ui_update = true;
            applet.reset(-1);
            block_ui_update = false;
        };
    }
    
    destroy() {
        this.#applet.unsubscribe(this.#sid1);
        this.#applet.unsubscribe(this.#sid2);
        this.actor.destroy();
    }
}

class Presets {
    actor;
    
    constructor(applet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });
        
        const presets = applet.storage.read.presets.value;
        
        if (presets.length) {
            const scrollbox = new ScrollBox();
            this.actor.add_child(scrollbox.actor);
            for (const [idx, preset] of presets.entries())
                scrollbox.box.add_child(new PresetCard(applet, preset, idx).actor);
        }
        
        const button_box = new ButtonBox(this.actor);
        const ok_button = button_box.add({ wide: true, label: _('Ok') });
        const add_button = button_box.add({ wide: true, label: _('Add Preset') });
        
        Misc.focus_when_mapped(ok_button.actor);
        
        add_button.subscribe('left_click', () => applet.show_preset_editor());
        ok_button.subscribe('left_click', () => applet.show_main_view());
    }
    
    destroy() {
        this.actor.destroy();
    }
}

class PresetCard extends Misc.Card {
    constructor(applet, preset, preset_idx) {
        super();
        this.left_header_box.add_style_class_name('cronomix-spacing');
        
        const checkbox = new CheckBox({ parent: this.left_header_box, checked: preset_idx === applet.storage.read.current_preset.value });
        
        const time = new Time(preset.time);
        const time_label = new St.Label({ text: time.fmt_hms(true), x_expand: true, style: 'font-weight: bold;', y_align: Clutter.ActorAlign.CENTER });
        this.left_header_box.add_child(time_label);
        
        const edit_button = new Button({ parent: this.autohide_box, icon: 'cronomix-edit-symbolic', style_class: 'cronomix-floating-button' });
        const delete_button = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic', style_class: 'cronomix-floating-button' });
        
        if (preset.text)
            this.actor.add_child(new Markup(preset.text).actor);
        
        edit_button.subscribe('left_click', () => applet.show_preset_editor(preset));
        delete_button.subscribe('left_click', () => show_confirm_popup(delete_button, () => { applet.delete_preset(preset_idx); applet.show_presets(); }));
        checkbox.subscribe('left_click', () => {
            const preset = checkbox.checked ? preset_idx : -1;
            if (applet.state === 2 /* State.RESET */)
                applet.reset(preset);
            else
                applet.set_preset(preset);
            applet.show_presets();
        });
    }
}

class PresetEditor extends EditorView {
    constructor(applet, preset) {
        super();
        
        const group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        this.main_view.left_box.add_child(group);
        
        const time_picker = new TimePicker();
        if (preset)
            time_picker.set_time(new Time(preset.time));
        new Misc.Row(_('Time'), time_picker.actor, group);
        
        const button_box = new ButtonBox(this.main_view.left_box);
        const ok_button = button_box.add({ wide: true, label: _('Ok') });
        const cancel_button = button_box.add({ wide: true, label: _('Cancel') });
        
        cancel_button.subscribe('left_click', () => applet.show_main_view());
        ok_button.subscribe('left_click', () => {
            const time = time_picker.get_time();
            
            if (time.total === 0) {
                show_error_popup(ok_button, _('Invalid time selected.'));
                return;
            }
            else if (preset) {
                preset.text = this.main_view.entry.entry.text;
                preset.time = time.total;
                applet.storage.flush();
                const preset_idx = applet.storage.read.presets.value.indexOf(preset);
                const current_idx = applet.storage.read.current_preset.value;
                if (current_idx === preset_idx && applet.state === 2 /* State.RESET */)
                    applet.reset(preset_idx);
            }
            else {
                applet.storage.modify('presets', v => v.value.push({ time: time.total, text: this.main_view.entry.entry.text }));
            }
            
            applet.show_presets();
        });
        
        this.main_view.entry.entry.set_text(preset?.text ?? '');
    }
    
    destroy() {
        this.actor.destroy();
    }
}

class TimerElapsedView {
    actor;
    
    constructor(applet, preset) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });
        
        const scrollbox = new ScrollBox();
        this.actor.add_child(scrollbox.actor);
        
        const markup = new Markup('##' + _('Timer Elapsed!') + '\n\n' + preset.text);
        scrollbox.box.add_child(markup.actor);
        
        const button_box = new ButtonBox(this.actor);
        const dismiss_button = button_box.add({ wide: true, label: _('Dismiss') });
        const restart_button = button_box.add({ wide: true, label: _('Restart') });
        
        Misc.focus_when_mapped(dismiss_button.actor);
        
        dismiss_button.subscribe('left_click', () => { applet.sound_cancel?.cancel(); applet.show_main_view(); });
        restart_button.subscribe('left_click', () => { applet.sound_cancel?.cancel(); applet.show_main_view(); applet.start(); });
    }
    
    destroy() {
        this.actor.destroy();
    }
}
