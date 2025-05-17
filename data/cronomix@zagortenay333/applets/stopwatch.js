import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Misc from './../utils/misc.js';
import { Storage } from './../utils/storage.js';
import { ButtonBox } from './../utils/button.js';
import { ScrollBox } from './../utils/scroll.js';
import { show_info_popup } from './../utils/popup.js';
import { Time, get_time_ms } from './../utils/time.js';
import { Markup } from './../utils/markup/renderer.js';
import { Applet, PanelPosition, PanelPositionTr } from './../applets/applet.js';

export class StopwatchApplet extends Applet {
    storage = new Storage({
        file: '~/.config/cronomix/stopwatch.json',
        
        values: {
            panel_position: { tag: 'enum', value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            show_panel_label: { tag: 'boolean', value: true },
            clock_size: { tag: 'number', value: 0, range: [0, 2000] },
            open: { tag: 'keymap', value: null },
        },
        
        groups: [
            ['panel_position', 'show_panel_label', 'clock_size'],
            ['open'],
        ],
        
        translations: {
            show_panel_label: _('Show time in panel'),
            panel_position: _('Panel position'),
            clock_size: _('Clock size (set to 0 for default size)'),
            open: _('Open'),
            ...PanelPositionTr,
        }
    });
    
    state = 2 /* State.RESET */;
    time;
    lap_time;
    laps = new Array();
    
    #tic_id = 0;
    #current_view = null;
    
    constructor(ext) {
        super(ext, 'stopwatch');
        this.storage.init_keymap({ open: () => this.panel_item.menu.open() });
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
    
    #tic(prev = get_time_ms()) {
        const now = get_time_ms();
        const dt = now - prev;
        
        this.time = new Time(this.time.total + dt);
        this.lap_time = new Time(this.lap_time.total + dt);
        
        this.set_panel_label(this.time.fmt_hmsc());
        this.#tic_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => this.#tic(now));
        this.publish('tic', { total: this.time, lap: this.lap_time });
    }
    
    start() {
        this.state = 0 /* State.RUNNING */;
        if (this.storage.read.show_panel_label.value)
            this.panel_label.show();
        this.publish('state_change', this.state);
        this.#tic();
    }
    
    reset() {
        this.state = 2 /* State.RESET */;
        this.time = new Time(0);
        this.lap_time = this.time;
        this.panel_label.hide();
        this.laps.length = 0;
        if (this.#tic_id) {
            GLib.source_remove(this.#tic_id);
            this.#tic_id = 0;
        }
        this.publish('state_change', this.state);
    }
    
    pause() {
        this.state = 1 /* State.PAUSED */;
        if (this.#tic_id) {
            GLib.source_remove(this.#tic_id);
            this.#tic_id = 0;
        }
        this.publish('state_change', this.state);
    }
    
    resume() {
        this.state = 0 /* State.RUNNING */;
        this.publish('state_change', this.state);
        this.#tic();
    }
    
    lap() {
        this.laps.unshift({ total: this.time, lap: this.lap_time });
        this.lap_time = new Time(0);
        this.publish('lap', this.laps);
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
        this.#current_view = { destroy: () => view.destroy() };
        this.menu.add_child(view);
    }
}

class MainView {
    actor;
    
    #sid1;
    #sid2;
    #sid3;
    #applet;
    
    constructor(applet) {
        this.#applet = applet;
        this.actor = new St.BoxLayout({ vertical: true, style: 'min-width: 256px;', style_class: 'cronomix-spacing' });
        
        //
        // Header
        //
        const header_buttons = new ButtonBox();
        const settings_button = header_buttons.add({ icon: 'cronomix-wrench-symbolic' });
        const header = new Misc.Row('', header_buttons.actor, this.actor);
        
        header_buttons.actor.y_align = Clutter.ActorAlign.START;
        Misc.focus_when_mapped(settings_button.actor);
        header.label.style = 'font-weight: bold;';
        if (applet.storage.read.clock_size.value > 0)
            header.label.style += `font-family: monospace; font-size: ${applet.storage.read.clock_size.value}px;`;
        
        //
        // buttons
        //
        const button_box = new ButtonBox(this.actor);
        const start_button = button_box.add({ wide: true, label: _('Start') });
        const pause_button = button_box.add({ wide: true, label: _('Pause') });
        const resume_button = button_box.add({ wide: true, label: _('Resume') });
        const cancel_button = button_box.add({ wide: true, label: _('Reset') });
        const lap_button = button_box.add({ wide: true, label: _('Lap') });
        const copy_button = button_box.add({ wide: true, label: _('Copy') });
        
        //
        // laps table
        //
        const laps_scroll = new ScrollBox();
        this.actor.add_child(laps_scroll.actor);
        
        //
        // update state
        //
        const update_ui = (state) => {
            const laps = this.#applet.laps;
            
            if (laps.length) {
                let markup = `|**\\#**\n|**${_('Lap Time')}**\n|**${_('Overall Time')}**\n|-\n`;
                for (const [idx, lap] of laps.entries())
                    markup += `|${laps.length - idx}\n|${lap.lap.fmt_hmsc()}\n|${lap.total.fmt_hmsc()}\n|-\n`;
                
                laps_scroll.box.destroy_all_children();
                const markup_widget = new Markup(markup).actor;
                markup_widget.add_style_class_name('floating');
                laps_scroll.box.add_child(markup_widget);
                
                laps_scroll.actor.show();
            }
            else {
                laps_scroll.actor.hide();
            }
            
            header.label.set_text(applet.time.fmt_hmsc());
            copy_button.actor.visible = laps_scroll.actor.visible;
            
            switch (state) {
                case 0 /* State.RUNNING */:
                    pause_button.actor.grab_key_focus();
                    lap_button.actor.show();
                    pause_button.actor.show();
                    start_button.actor.hide();
                    cancel_button.actor.hide();
                    resume_button.actor.hide();
                    break;
                case 1 /* State.PAUSED */:
                    resume_button.actor.grab_key_focus();
                    cancel_button.actor.show();
                    resume_button.actor.show();
                    start_button.actor.hide();
                    lap_button.actor.hide();
                    pause_button.actor.hide();
                    break;
                case 2 /* State.RESET */:
                    start_button.actor.grab_key_focus();
                    start_button.actor.show();
                    cancel_button.actor.hide();
                    pause_button.actor.hide();
                    resume_button.actor.hide();
                    lap_button.actor.hide();
                    break;
                default:
                    Misc.unreachable(state);
            }
        };
        
        update_ui(applet.state);
        
        //
        // listen
        //
        this.#sid2 = applet.subscribe('state_change', (state) => update_ui(state));
        this.#sid1 = applet.subscribe('tic', (times) => header.label.set_text(times.total.fmt_hmsc()));
        this.#sid3 = applet.subscribe('lap', () => { update_ui(applet.state); lap_button.actor.grab_key_focus(); });
        settings_button.subscribe('left_click', () => applet.show_settings());
        start_button.subscribe('left_click', () => applet.start());
        cancel_button.subscribe('left_click', () => applet.reset());
        pause_button.subscribe('left_click', () => applet.pause());
        resume_button.subscribe('left_click', () => applet.resume());
        lap_button.subscribe('left_click', () => applet.lap());
        copy_button.subscribe('left_click', () => {
            const laps = this.#applet.laps;
            let result = '#, ' + _('Lap Times') + ', ' + _('Overall Time') + '\n';
            for (const [idx, lap] of laps.entries())
                result += `${laps.length - idx}, ${lap.lap.fmt_hmsc()}, ${lap.total.fmt_hmsc()}\n`;
            Misc.copy_to_clipboard(result);
            show_info_popup(copy_button, _('Laps table copied to clipboard!'));
        });
    }
    
    destroy() {
        this.#applet.unsubscribe(this.#sid1);
        this.#applet.unsubscribe(this.#sid2);
        this.#applet.unsubscribe(this.#sid3);
        this.actor.destroy();
    }
}
