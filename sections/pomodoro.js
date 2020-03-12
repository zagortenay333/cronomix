const St          = imports.gi.St;
const Gio         = imports.gi.Gio
const GLib        = imports.gi.GLib;
const Clutter     = imports.gi.Clutter;
const MessageTray = imports.ui.messageTray;
const Main        = imports.ui.main;
const CheckBox    = imports.ui.checkBox;
const ByteArray   = imports.byteArray;
const Signals     = imports.signals;
const Mainloop    = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SOUND_PLAYER = ME.imports.lib.sound_player;
const MISC_UTILS   = ME.imports.lib.misc_utils;
const FULLSCREEN   = ME.imports.lib.fullscreen;
const SIG_MANAGER  = ME.imports.lib.signal_manager;
const KEY_MANAGER  = ME.imports.lib.keybinding_manager;
const PANEL_ITEM   = ME.imports.lib.panel_item;
const NUM_PICKER   = ME.imports.lib.num_picker;
const MULTIL_ENTRY = ME.imports.lib.multiline_entry;


const IFACE = `${ME.path}/dbus/pomodoro_iface.xml`;


const CACHE_FILE = '~/.cache/timepp_gnome_shell_extension/timepp_pomodoro.json';


const POMO_STARTED_MSG = _('Pomodoro');
const LONG_BREAK_MSG   = _('Long Break')
const SHORT_BREAK_MSG  = _('Short Break')


const PomoState = {
    STOPPED     : 'STOPPED',
    POMO        : 'POMO',
    LONG_BREAK  : 'LONG_BREAK',
    SHORT_BREAK : 'SHORT_BREAK',
};


const NotifStyle = {
    STANDARD   : 0,
    FULLSCREEN : 1,
    NONE       : 2,
};


const PanelMode = {
    ICON      : 0,
    TEXT      : 1,
    ICON_TEXT : 2,
    DYNAMIC   : 3,
};


// =====================================================================
// @@@ Main
//
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
// =====================================================================
var SectionMain = class SectionMain extends ME.imports.sections.section_base.SectionBase{
    constructor (section_name, ext, settings) {
        super(section_name, ext, settings);

        this.actor.add_style_class_name('pomo-section');

        this.separate_menu = this.settings.get_boolean('pomodoro-separate-menu');


        this.pomo_state       = PomoState.STOPPED;
        this.tic_mainloop_id  = null;
        this.cache_file       = null;
        this.cache            = null;
        this.notif_source     = null;
        this.clock            = 0; // microseconds
        this.end_time         = 0; // For computing elapsed time (microseconds)


        this.sigm = new SIG_MANAGER.SignalManager();
        this.keym = new KEY_MANAGER.KeybindingManager(this.settings);


        this.sound_player = new SOUND_PLAYER.SoundPlayer();


        this.fullscreen = new PomodoroFullscreen(this.ext, this,
            this.settings.get_int('pomodoro-fullscreen-monitor-pos'));


        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + ByteArray.toString(xml);
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
            this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/Pomodoro');
        }


        try {
            this.cache_file = MISC_UTILS.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].pomodoro;

            if (this.cache_file.query_exists(null)) {
                let [, contents] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(ByteArray.toString(contents));
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                this.cache = {
                    format_version  : cache_format_version,
                    pomo_counter    : 0,
                    pomo_duration   : 1500, // seconds
                    short_break     : 300,  // seconds
                    long_break      : 900,  // seconds
                    long_break_rate : 4,
                    todo_task_id    : '',
                };
            }
        } catch (e) {
            logError(e);
            return;
        }


        //
        // keybindings
        //
        this.keym.add('pomodoro-keybinding-open', () => {
             this.ext.open_menu(this.section_name);
        });
        this.keym.add('pomodoro-keybinding-open-fullscreen', () => {
            this.show_fullscreen();
        });


        //
        // panel item
        //
        this.panel_item.actor.add_style_class_name('pomodoro-panel-item');
        this.panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-pomodoro-symbolic');
        this.panel_item.set_label(this.settings.get_boolean('pomodoro-show-seconds') ? '00:00:00' : '00:00');
        this._toggle_panel_mode();


        //
        // header
        //
        this.header = new St.BoxLayout({ style_class: 'timepp-menu-item header' });
        this.actor.add_actor(this.header);

        this.header_label = new St.Label({ x_expand: true, text: _('Timer'), style_class: 'clock' });
        this.header.add_child(this.header_label);


        // pomo phase label
        this.phase_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-phase-label popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.header.add_child(this.phase_label);


        // clock
        this.clock_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-counter' });
        this.header.add_child(this.clock_label);


        // icons
        this.icon_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.add_actor(this.icon_box);

        this.fullscreen_icon = new St.Icon({ reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-fullscreen-symbolic'), style_class: 'fullscreen-icon' });
        this.icon_box.add_actor(this.fullscreen_icon);

        this.settings_icon = new St.Icon({ reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-settings-symbolic'), style_class: 'settings-icon' });
        this.icon_box.add_actor(this.settings_icon);


        //
        // buttons
        //
        this.button_box = new St.BoxLayout({ x_expand: true, style_class: 'timepp-menu-item btn-box' });
        this.actor.add(this.button_box);

        this.button_new_pomo   = new St.Button({can_focus:  true, label: _('New Pomo'), x_expand: true, style_class: 'button'});
        this.button_take_break = new St.Button({can_focus: true, label: _('Take Break'), x_expand: true, visible: false, style_class: 'button'});
        this.button_continue   = new St.Button({can_focus: true, label: _('Continue'), x_expand: true, visible: false, style_class: 'button'});
        this.button_stop       = new St.Button({can_focus: true, label: _('Stop'), x_expand: true, visible: false, style_class: 'button'});

        this.button_box.add_actor(this.button_new_pomo);
        this.button_box.add_actor(this.button_take_break);
        this.button_box.add_actor(this.button_continue);
        this.button_box.add_actor(this.button_stop);


        //
        // settings container
        //
        this.settings_container = new St.Bin({x_fill: true});
        this.actor.add_actor(this.settings_container);


        //
        // listen
        //
        this.sigm.connect(this.fullscreen, 'monitor-changed', () => {
            this.settings.set_int('pomodoro-fullscreen-monitor-pos', this.fullscreen.monitor);
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('pomodoro-separate-menu');
            this.ext.update_panel_items();
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-show-seconds', () => this._update_time_display());
        this.sigm.connect(this.settings, 'changed::pomodoro-panel-mode', () => this._toggle_panel_mode());
        this.sigm.connect(this.panel_item, 'middle-click', () => this.timer_toggle());
        this.sigm.connect_release(this.settings_icon, Clutter.BUTTON_PRIMARY, true, () => this._show_settings());
        this.sigm.connect_release(this.fullscreen_icon, Clutter.BUTTON_PRIMARY, true, () => this.show_fullscreen());
        this.sigm.connect_release(this.button_continue, Clutter.BUTTON_PRIMARY, true, () => this.start_pomo());
        this.sigm.connect_release(this.button_stop, Clutter.BUTTON_PRIMARY, true, () => this.stop());
        this.sigm.connect_release(this.button_new_pomo, Clutter.BUTTON_PRIMARY, true, () => this.start_new_pomo());
        this.sigm.connect_release(this.button_take_break, Clutter.BUTTON_PRIMARY, true, () => this.take_break());


        //
        // finally
        //
        let count_str         = String(this.cache.pomo_counter);
        this.clock_label.text = this.cache.pomo_counter ? count_str : '';
        this.clock            = this.cache.pomo_duration * 1000000;

        this._update_time_display();
        this.header_label.text = _('Pomodoro');
    }

    disable_section () {
        this.dbus_impl.unexport();
        this.stop();
        this._store_cache();
        this.sigm.clear();
        this.keym.clear();

        if (this.fullscreen) {
            this.fullscreen.destroy();
            this.fullscreen = null;
        }

        super.disable_section();
    }

    _store_cache () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    _show_settings () {
        let settings = new PomodoroSettings(this.ext, this, this.cache);
        this.settings_container.add_actor(settings.actor);
        settings.button_cancel.grab_key_focus();

        this.header.hide();
        this.button_box.hide();

        settings.connect('ok', (_, res) => {
            this.cache.todo_task_id = res.todo_task_id;

            this.set_phase_durations(
                res.pomo, res.short_break, res.long_break, res.break_rate);

            if (this.pomo_state === PomoState.STOPPED)
                this.clock = this.cache.pomo_duration * 1000000;

            if (res.clear_counter)
                this.clear_pomo_counter();

            this.button_box.show();
            this.button_box.grab_key_focus();
            settings.actor.destroy();
            this.header.show();

            this._update_time_display();
        });

        settings.connect('cancel', () => {
            this.button_box.show();
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.show();
        });
    }

    show_fullscreen () {
        this.ext.menu.close();

        if (! this.fullscreen) {
            this.fullscreen = new PomodoroFullscreen(this.ext, this,
                this.settings.get_int('pomodoro-fullscreen-monitor-pos'));
        }

        this.fullscreen.open();
    }

    clear_pomo_counter () {
        this.cache.pomo_counter = 0;
        this.clock_label.text = '';
        this._store_cache();
    }

    // @pomo        : int (seconds)
    // @short_break : int (seconds)
    // @long_break  : int (seconds)
    // @break_rate  : int (num of pomos until long break)
    set_phase_durations (pomo, short_break, long_break, break_rate) {
        this.cache.pomo_duration   = Math.max(1, pomo);
        this.cache.short_break     = Math.max(1, short_break);
        this.cache.long_break      = Math.max(1, long_break);
        this.cache.long_break_rate = Math.max(1, break_rate);

        this._store_cache();
    }

    stop () {
        this.clock = this.end_time - GLib.get_monotonic_time();

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.pomo_state === PomoState.STOPPED)
            return;

        if (this.pomo_state !== PomoState.POMO) {
            this.clock             = this.cache.pomo_duration;
            this.header_label.text = _('Pomodoro');
        }

        this.sound_player.stop();
        if (this.notif_source) this.notif_source.destroyNonResidentNotifications();

        {
            let in_break = this.pomo_state === PomoState.LONG_BREAK ||
                           this.pomo_state === PomoState.SHORT_BREAK;

            this.button_continue.visible              = !in_break;
            this.fullscreen.button_continue.visible   = !in_break;
            this.button_new_pomo.visible              = true;
            this.fullscreen.button_new_pomo.visible   = true;
            this.button_stop.visible                  = false;
            this.button_take_break.visible            = false;
            this.fullscreen.button_stop.visible       = false;
            this.fullscreen.button_take_break.visible = false;
        }

        this.pomo_state = PomoState.STOPPED;

        if (!this.fullscreen.is_open && this.actor.visible)
            this.button_stop.grab_key_focus();

        this.fullscreen.on_stop();
        this._update_phase_label();
        this._update_panel_item();

        if (this.settings.get_enum('pomodoro-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon');

        this.dbus_impl.emit_signal('pomo_state_changed', GLib.Variant.new('(s)', [this.pomo_state]));

        if (this.cache.todo_task_id) {
            this.ext.emit_to_sections('stop-time-tracking-by-id', this.section_name, this.cache.todo_task_id);
        }
    }

    start_new_pomo () {
        this.start_pomo(this.cache.pomo_duration);
    }

    // @time: int (seconds)
    start_pomo (time) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (time) time *= 1000000;
        else      time  = this.clock;

        this.pomo_state = PomoState.POMO;
        this.end_time = GLib.get_monotonic_time() + time;

        this.sound_player.stop();
        if (this.notif_source) this.notif_source.destroyNonResidentNotifications();

        this._update_panel_item();
        this._update_phase_label();
        this.button_continue.visible              = false;
        this.button_stop.visible                  = true;
        this.button_take_break.visible            = true;
        this.button_new_pomo.visible              = true;
        this.fullscreen.button_continue.visible   = false;
        this.fullscreen.button_stop.visible       = true;
        this.fullscreen.button_take_break.visible = true;
        this.fullscreen.button_new_pomo.visible   = true;

        if (this.settings.get_enum('pomodoro-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon_text');

        if (!this.fullscreen.is_open && this.actor.visible)
            this.button_stop.grab_key_focus();

        this._tic();

        this.fullscreen.on_start();
        this.dbus_impl.emit_signal('pomo_state_changed', GLib.Variant.new('(s)', [this.pomo_state]));
        if (this.cache.todo_task_id) {
            this.ext.emit_to_sections('start-time-tracking-by-id', this.section_name, this.cache.todo_task_id);
        }
    }

    take_break () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.cache.pomo_counter && (this.cache.pomo_counter % this.cache.long_break_rate) === 0) {
            this.pomo_state = PomoState.LONG_BREAK;
            this.clock      = this.cache.long_break * 1000000;
        } else {
            this.pomo_state = PomoState.SHORT_BREAK;
            this.clock      = this.cache.short_break * 1000000;
        }

        this.end_time = GLib.get_monotonic_time() + this.clock;

        this.sound_player.stop();
        if (this.notif_source) this.notif_source.destroyNonResidentNotifications();

        this._update_time_display();
        this._update_phase_label();
        this._update_panel_item();
        this.fullscreen.on_break();

        this.button_continue.visible              = false;
        this.button_stop.visible                  = true;
        this.button_take_break.visible            = false;
        this.fullscreen.button_continue.visible   = false;
        this.fullscreen.button_stop.visible       = true;
        this.fullscreen.button_take_break.visible = false;
        this.fullscreen.button_new_pomo.visible   = true;

        if (this.settings.get_enum('pomodoro-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon_text');

        if (this.cache.todo_task_id)
            this.ext.emit_to_sections('stop-time-tracking-by-id', this.section_name, this.cache.todo_task_id);

        this._tic();

        this.dbus_impl.emit_signal('pomo_state_changed', GLib.Variant.new('(s)', [this.pomo_state]));
    }

    timer_toggle () {
        if (this.pomo_state === PomoState.STOPPED)
            this.start_pomo();
        else
            this.stop();
    }

    _update_time_display () {
        let time = Math.ceil(this.clock / 1000000);
        let txt;

        // If the seconds are not shown, we need to make the timer '1-indexed'
        // with respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('pomodoro-show-seconds')) {
            txt = "%02d:%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );
        } else {
            if (time > 0 && time !== this.cache.pomo_duration) time += 60;

            txt = "%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60)
            );
        }

        this.header_label.text = txt;
        this.panel_item.set_label(txt);
        this.fullscreen.set_banner_text(txt);
    }

    _update_phase_label () {
        switch (this.pomo_state) {
          case PomoState.POMO:
            this.phase_label.text            = POMO_STARTED_MSG;
            this.fullscreen.phase_label.text = POMO_STARTED_MSG;
            break;
          case PomoState.LONG_BREAK:
            this.phase_label.text            = LONG_BREAK_MSG;
            this.fullscreen.phase_label.text = LONG_BREAK_MSG;
            break;
          case PomoState.SHORT_BREAK:
            this.phase_label.text            = SHORT_BREAK_MSG;
            this.fullscreen.phase_label.text = SHORT_BREAK_MSG;
            break;
          case PomoState.STOPPED:
            this.phase_label.text            = '';
            this.fullscreen.phase_label.text = '';
            break;
        }
    }

    _update_panel_item () {
        if (this.pomo_state === PomoState.STOPPED)
            this.panel_item.actor.remove_style_class_name('on');
        else
            this.panel_item.actor.add_style_class_name('on');
    }

    _timer_expired () {
        if (this.pomo_state === PomoState.LONG_BREAK ||
            this.pomo_state === PomoState.SHORT_BREAK) {

            this.start_new_pomo();
        }
        else {
            this.cache.pomo_counter += 1;
            this._store_cache();
            this.take_break();
            this.clock_label.text = '' + this.cache.pomo_counter;
        }

        this._send_notif();
    }

    _tic () {
        this.clock = this.end_time - GLib.get_monotonic_time();

        if (this.clock <= 0) {
            this.tic_mainloop_id = null;
            this._timer_expired();
            return;
        }

        this._update_time_display();

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tic();
        });
    }

    _send_notif () {
        let do_play_sound, msg;

        switch (this.pomo_state) {
          case PomoState.POMO:
            msg = POMO_STARTED_MSG;
            do_play_sound = this.settings.get_boolean('pomodoro-play-sound-pomo');
            this.sound_player.set_sound_uri(this.settings.get_string('pomodoro-sound-file-path-pomo'));
            break;
          case PomoState.SHORT_BREAK:
            msg = SHORT_BREAK_MSG;
            do_play_sound = this.settings.get_boolean('pomodoro-play-sound-short-break');
            this.sound_player.set_sound_uri(this.settings.get_string('pomodoro-sound-file-path-short-break'));
            break;
          case PomoState.LONG_BREAK:
            msg = LONG_BREAK_MSG;
            do_play_sound = this.settings.get_boolean('pomodoro-play-sound-long-break');
            this.sound_player.set_sound_uri(this.settings.get_string('pomodoro-sound-file-path-long-break'));
            break;
          default:
            return;
        }

        let notif_style = this.settings.get_enum('pomodoro-notif-style');

        if (notif_style === NotifStyle.NONE || this.fullscreen.is_open) {
            // do nothing
        } else if (notif_style === NotifStyle.FULLSCREEN) {
            this.fullscreen.open();
        } else {
            if (this.notif_source) {
                this.notif_source.destroyNonResidentNotifications();
            }

            this.notif_source = new MessageTray.Source();
            Main.messageTray.add(this.notif_source);
            this.notif_source.connect('destroy', () => this.sound_player.stop());

            let icon   = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-pomodoro-symbolic') });
            let params = {
                bannerMarkup : true,
                gicon        : icon.gicon,
            };

            let notif = new MessageTray.Notification(this.notif_source, msg, '', params);
            notif.setUrgency(MessageTray.Urgency.NORMAL);

            this.notif_source.notify(notif);
        }

        if (do_play_sound)
            this.sound_player.play(this.settings.get_boolean('pomodoro-do-repeat-notif-sound'));
    }

    _toggle_panel_mode () {
        switch (this.settings.get_enum('pomodoro-panel-mode')) {
          case PanelMode.ICON:
            this.panel_item.set_mode('icon');
            break;
          case PanelMode.TEXT:
            this.panel_item.set_mode('text');
            break;
          case PanelMode.ICON_TEXT:
            this.panel_item.set_mode('icon_text');
            break;
          case PanelMode.DYNAMIC:
            if (this.pomo_state === PomoState.STOPPED)
                this.panel_item.set_mode('icon');
            else
                this.panel_item.set_mode('icon_text');
        }
    }
}
Signals.addSignalMethods(SectionMain.prototype);



// =====================================================================
// @@@ Pomodoro settings
//
// @delegate   : obj (main section object)
// @pomo_cache : obj (section cache object)
//
// @signals: 'ok', 'cancel'
// =====================================================================
var PomodoroSettings = class PomodoroSettings {
    constructor (ext, delegate, pomo_cache) {
        this.ext      = ext;
        this.delegate = delegate;

        this.actor = new St.BoxLayout({style_class: 'view-box'});

        this.content_box = new St.BoxLayout({vertical: true, style_class: 'view-box-content'});
        this.actor.add(this.content_box, {expand: true});


        //
        // clear all pomodoros
        //
        this.clear_all_item = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.clear_all_item);

        this.clear_item_label = new St.Label({text: `${_('Reset pomodoro counter?')} `, y_align: Clutter.ActorAlign.CENTER});
        this.clear_all_item.add(this.clear_item_label, {expand: true});

        this.clear_checkbox_bin = new St.Bin();
        this.clear_all_item.add_actor(this.clear_checkbox_bin);

        this.clear_item_checkbox = new CheckBox.CheckBox();
        this.clear_checkbox_bin.add_actor(this.clear_item_checkbox.actor);


        //
        // pomodoro duration
        //
        this.pomo_duration = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.pomo_duration);

        this.pomo_label = new St.Label({text: `${POMO_STARTED_MSG} ${_('(min:sec)')} `, y_align: Clutter.ActorAlign.CENTER});
        this.pomo_duration.add(this.pomo_label, {expand: true});

        this.pomo_dur_min_picker = new NUM_PICKER.NumPicker(0, null);
        this.pomo_duration.add_actor(this.pomo_dur_min_picker.actor);

        this.pomo_dur_sec_picker = new NUM_PICKER.NumPicker(0, null);
        this.pomo_duration.add_actor(this.pomo_dur_sec_picker.actor);

        this.pomo_dur_min_picker.set_counter(Math.floor(pomo_cache.pomo_duration / 60));
        this.pomo_dur_sec_picker.set_counter(pomo_cache.pomo_duration % 60);


        //
        // short break
        //
        this.short_break = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.short_break);

        this.short_break_label = new St.Label({text: `${SHORT_BREAK_MSG} ${_('(min:sec)')} `, y_align: Clutter.ActorAlign.CENTER});
        this.short_break.add(this.short_break_label, {expand: true});

        this.short_break_min_picker = new NUM_PICKER.NumPicker(0, null);
        this.short_break.add_actor(this.short_break_min_picker.actor);

        this.short_break_sec_picker = new NUM_PICKER.NumPicker(0, null);
        this.short_break.add_actor(this.short_break_sec_picker.actor);

        this.short_break_min_picker.set_counter(Math.floor(pomo_cache.short_break / 60));
        this.short_break_sec_picker.set_counter(pomo_cache.short_break % 60);


        //
        // long break
        //
        this.long_break = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.long_break);

        this.long_break_label = new St.Label({text: `${LONG_BREAK_MSG} ${_('(min:sec)')} `, y_align: Clutter.ActorAlign.CENTER});
        this.long_break.add(this.long_break_label, {expand: true});

        this.long_break_min_picker = new NUM_PICKER.NumPicker(0, null);
        this.long_break.add_actor(this.long_break_min_picker.actor);

        this.long_break_sec_picker = new NUM_PICKER.NumPicker(0, null);
        this.long_break.add_actor(this.long_break_sec_picker.actor);

        this.long_break_min_picker.set_counter(Math.floor(pomo_cache.long_break / 60));
        this.long_break_sec_picker.set_counter(pomo_cache.long_break % 60);


        //
        // how many pomodoros 'till long break
        //
        this.long_break_rate = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.long_break_rate);

        this.long_break_rate_label = new St.Label({text: `${_('Num of pomos until long break')} `, y_align: Clutter.ActorAlign.CENTER});
        this.long_break_rate.add(this.long_break_rate_label, {expand: true});

        this.long_break_rate_picker = new NUM_PICKER.NumPicker(1, null);
        this.long_break_rate.add_actor(this.long_break_rate_picker.actor);

        this.long_break_rate_picker.set_counter(pomo_cache.long_break_rate);


        //
        // task id entry
        //
        if (this.ext.is_section_enabled('Todo')) {
            let entry_container = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row' });
            this.content_box.add_child(entry_container);

            this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Control todo time tracker by task id...'), false, true);
            entry_container.add_child(this.entry.actor);

            this.entry.set_text(this.delegate.cache.todo_task_id);
        }


        //
        // buttons
        //
        this.button_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add(this.button_box, {expand: true});

        this.button_ok      = new St.Button({can_focus: true, label: _('Ok'), x_expand: true, style_class: 'button'});
        this.button_cancel = new St.Button({can_focus: true, label: _('Cancel'), x_expand: true, style_class: 'button'});

        this.button_box.add(this.button_cancel, {expand: true});
        this.button_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', () => {
            this.emit('ok', {
                clear_counter : this.clear_item_checkbox.actor.checked,
                break_rate    : this.long_break_rate_picker.counter,
                pomo          : this.pomo_dur_min_picker.counter * 60 +
                                this.pomo_dur_sec_picker.counter,
                short_break   : this.short_break_min_picker.counter * 60 +
                                this.short_break_sec_picker.counter,
                long_break    : this.long_break_min_picker.counter * 60 +
                                this.long_break_sec_picker.counter,
                todo_task_id :  this.entry ? this.entry.entry.get_text() : this.delegate.cache.todo_task_id,
            });
        });
        this.button_cancel.connect('clicked', () => {
            this.emit('cancel');
        });
        this.pomo_dur_min_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.pomo_dur_sec_picker.counter === 0)
                this.pomo_dur_min_picker.set_counter(1);
        });
        this.pomo_dur_sec_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.pomo_dur_min_picker.counter === 0)
                this.pomo_dur_sec_picker.set_counter(1);
        });
        this.long_break_min_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.long_break_sec_picker.counter === 0)
                this.long_break_min_picker.set_counter(1);
        });
        this.long_break_sec_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.long_break_min_picker.counter === 0)
                this.long_break_sec_picker.set_counter(1);
        });
        this.short_break_min_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.short_break_sec_picker.counter === 0)
                this.short_break_min_picker.set_counter(1);
        });
        this.short_break_sec_picker.connect('spinner-changed', (_, n) => {
            if (n === 0 && this.short_break_min_picker.counter === 0)
                this.short_break_sec_picker.set_counter(1);
        });
    }
}
Signals.addSignalMethods(PomodoroSettings.prototype);



// =====================================================================
// @@@ Pomodoro fullscreen
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int
//
// signals: 'monitor-changed'
// =====================================================================
var PomodoroFullscreen = class PomodoroFullscreen extends FULLSCREEN.Fullscreen {
    constructor (ext, delegate, monitor) {
        super(monitor);

        this.ext      = ext;
        this.delegate = delegate;

        this.default_style_class = this.actor.style_class;


        //
        // phase label
        //
        this.phase_label = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-phase-label' });
        this.middle_box.insert_child_at_index(this.phase_label, 0);


        //
        // buttons
        //
        this.button_box = new St.BoxLayout({ x_expand: true, y_expand: true, style_class: 'btn-box', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, });
        this.bottom_box.add_child(this.button_box)

        this.button_new_pomo   = new St.Button({can_focus: true, label: _('New Pomo'), visible: false, style_class: 'button'});
        this.button_take_break = new St.Button({can_focus: true, label: _('Take Break'), visible: false, style_class: 'button'});
        this.button_continue   = new St.Button({can_focus: true, label: _('Continue'), style_class: 'button'});
        this.button_stop       = new St.Button({can_focus: true, label: _('Stop'), visible: false, style_class: 'button'});
        this.button_box.add_child(this.button_new_pomo);
        this.button_box.add_child(this.button_take_break);
        this.button_box.add_child(this.button_continue);
        this.button_box.add_child(this.button_stop);


        //
        // listen
        //
        this.button_continue.connect('clicked', () => {
            this.delegate.start_pomo();
            return Clutter.EVENT_STOP;
        });
        this.button_stop.connect('clicked', () => {
            this.delegate.stop();
            return Clutter.EVENT_STOP;
        });
        this.button_new_pomo.connect('clicked',() => {
            this.delegate.start_new_pomo();
            return Clutter.EVENT_STOP;
        });
        this.button_take_break.connect('clicked', () => {
            this.delegate.take_break();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-release-event', (_, event) => {
            switch (event.get_key_symbol()) {
              case Clutter.KEY_space:
                this.delegate.timer_toggle();
                return Clutter.EVENT_STOP;
              default:
                return Clutter.EVENT_PROPAGATE;
            }
        });
    }

    close () {
        this.delegate.sound_player.stop();
        super.close();
    }

    on_start () {
        switch (this.delegate.pomo_state) {
          case PomoState.POMO:
            this.actor.style_class = this.default_style_class + ' pomo-running';
            break;
          case PomoState.LONG_BREAK:
            this.actor.style_class = this.default_style_class + ' pomo-long-break';
            break;
          case PomoState.SHORT_BREAK:
            this.actor.style_class = this.default_style_class + ' pomo-short-break';
            break;
        }
    }

    on_stop () {
        this.actor.style_class = this.default_style_class + ' pomo-stopped';
        this.phase_label.text  = '';
    }

    on_new_pomo () {
        this.actor.style_class = this.default_style_class + ' pomo-running';
        this.phase_label.text  = POMO_STARTED_MSG;
    }

    on_break () {
        switch (this.delegate.pomo_state) {
          case PomoState.LONG_BREAK:
            this.actor.style_class = this.default_style_class + ' pomo-long-break';
            this.phase_label.text  = LONG_BREAK_MSG;
            break;
          case PomoState.SHORT_BREAK:
            this.actor.style_class = this.default_style_class + ' pomo-short-break';
            this.phase_label.text  = SHORT_BREAK_MSG;
            break;
        }
    }
}
Signals.addSignalMethods(PomodoroFullscreen.prototype);
