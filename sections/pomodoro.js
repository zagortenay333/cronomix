const St             = imports.gi.St;
const Gio            = imports.gi.Gio
const GLib           = imports.gi.GLib;
const Meta           = imports.gi.Meta;
const Shell          = imports.gi.Shell;
const Clutter        = imports.gi.Clutter;
const MessageTray    = imports.ui.messageTray;
const Main           = imports.ui.main;
const CheckBox       = imports.ui.checkBox;
const PopupMenu      = imports.ui.popupMenu;
const Util           = imports.misc.util;
const Lang           = imports.lang;
const Signals        = imports.signals;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const SIG_MANAGER   = ME.imports.lib.signal_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const ICON_FROM_URI = ME.imports.lib.icon_from_uri;
const NUM_PICKER    = ME.imports.lib.num_picker;


const CACHE_FILE = GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension/timepp_pomodoro.json';
const POMODORO_ICON = '/img/pomodoro-symbolic.svg';


const PomoState = {
    POMO        : 'POMO',
    SHORT_BREAK : 'SHORT_BREAK',
    LONG_BREAK  : 'LONG_BREAK',
    STOPPED     : 'STOPPED',
};


//
// time_str: string representing time in hh:mm 24h format. E.g., '13:44'.
//


// =====================================================================
// @@@ Main
// =====================================================================
const Pomodoro = new Lang.Class({
    Name: 'Timepp.Pomodoro',

    _init: function (ext, ext_dir, settings) {
        this.ext      = ext;
        this.ext_dir  = ext_dir;
        this.settings = settings;


        this.sigm = new SIG_MANAGER.SignalManager();


        this.keybindings     = [];
        this.pomo_phase      = PomoState.STOPPED;
        this.tic_mainloop_id = null;
        this.timer_state     = false;
        this.timer_duration  = 0; // in microseconds
        this.end_time        = 0; // used for computing elapsed time
        this.section_enabled = this.settings.get_boolean('pomodoro-enabled');
        this.separate_menu   = this.settings.get_boolean('pomodoro-separate-menu');
        this.cache_file      = null;
        this.cache           = null;


        //
        // panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        this.panel_item.set_label(this.settings.get_boolean('pomodoro-show-seconds') ? '00:00:00' : '00:00');
        this.panel_item.actor.add_style_class_name('pomodoro-panel-item');
        this._update_panel_icon_name();
        this._toggle_panel_mode();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        //
        // pomodoro pane
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section pomo-section' });


        //
        // start pomodoro item
        //
        this.header = new PopupMenu.PopupMenuItem(_('Pomodoro'), { hover: false, activate: false, style_class: 'header' });
        this.header.actor.can_focus = false;
        this.actor.add_actor(this.header.actor);


        //
        // pomo counter
        //
        this.pomo_counter_display = new St.Label({ x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-counter' });
        this.header.actor.add(this.pomo_counter_display, {expand: true});


        //
        // settings icon
        //
        this.icon_bin = new St.Button({ can_focus: true, x_align: St.Align.END, y_align: St.Align.MIDDLE, style_class: 'settings-icon' });
        this.header.actor.add_actor(this.icon_bin);

        this.settings_icon = new St.Icon({icon_name: 'open-menu-symbolic'});
        this.icon_bin.add_actor(this.settings_icon);


        //
        // buttons
        //
        this.btn_box_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add_actor(this.btn_box_wrapper.actor);
        this.btn_box_wrapper.label.hide();
        this.btn_box_wrapper.actor.can_focus = false;

        this.button_box = new St.BoxLayout({ style_class: 'btn-box' });
        this.btn_box_wrapper.actor.add(this.button_box, {expand: true});

        this.button_new_pomo = new St.Button({can_focus:  true, label: _('New Pomo'), x_expand: true, visible: false, style_class: 'button'});
        this.button_take_break = new St.Button({can_focus: true, label: _('Take Break'), x_expand: true, visible: false, style_class: 'button'});
        this.button_start = new St.Button({can_focus: true, label: _('Start'), x_expand: true, style_class: 'button'});
        this.button_stop = new St.Button({can_focus: true, label: _('Stop'), x_expand: true, visible: false, style_class: 'button'});

        this.button_box.add(this.button_new_pomo, {expand: true});
        this.button_box.add(this.button_take_break, {expand: true});
        this.button_box.add(this.button_start, {expand: true});
        this.button_box.add(this.button_stop, {expand: true});


        //
        // settings container
        //
        this.settings_container = new St.Bin({x_fill: true});
        this.actor.add_actor(this.settings_container);


        //
        // listen
        //
        this.settings.connect('changed::pomodoro-enabled', () => {
            this.section_enabled = this.settings.get_boolean('pomodoro-enabled');
            this._toggle_section();
        }); // don't put this signal into the signal manager

        this.sigm.connect(this.settings, 'changed::pomodoro-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('pomodoro-separate-menu');
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-show-seconds', () => {
            this._update_time_display();
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-panel-mode', () => {
            this._toggle_panel_mode();
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-keybinding-open', () => {
            this._toggle_keybindings();
        });
        this.sigm.connect(this.panel_item, 'click', Lang.bind(this, function () {
            this.emit('toggle-menu');
        }));
        this.sigm.connect(this.panel_item, 'middle-click', Lang.bind(this, this._timer_toggle));
        this.sigm.connect(this.icon_bin, 'clicked', Lang.bind(this, this._show_settings));
        this.sigm.connect(this.button_start, 'clicked', Lang.bind(this, this._start));
        this.sigm.connect(this.button_stop, 'clicked', Lang.bind(this, this._stop));
        this.sigm.connect(this.button_new_pomo, 'clicked', Lang.bind(this, this._start_new_pomo));
        this.sigm.connect(this.button_take_break, 'clicked', Lang.bind(this, this._take_break));


        if (this.section_enabled) this._init__finish();
        else                      this.sigm.disconnect_all();
    },

    _init__finish: function () {
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            if (this.cache_file.query_exists(null)) {
                let [, contents] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }
            else
                this.cache = {
                    pomo_counter    : 0,
                    pomo_duration   : 150000000,
                    short_break     : 300000000,
                    long_break      : 900000000,
                    long_break_rate : 4,
                };
        } catch (e) { logError(e); }

        let count_str = String(this.cache.pomo_counter);
        this.pomo_counter_display.text = this.cache.pomo_counter ? count_str : '';
        this.timer_duration = this.cache.pomo_duration;

        this._toggle_keybindings();
        this._update_time_display();
        this.header.label.text = _('Pomodoro');
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    _show_settings: function () {
        let settings = new PomodoroSettings(this.cache);
        this.settings_container.add_actor(settings.actor);
        settings.button_cancel.grab_key_focus();

        this.header.actor.hide();
        this.btn_box_wrapper.actor.hide();

        settings.connect('ok', Lang.bind(this, function (actor, clear_pomo_counter) {
            this._store_cache();

            if (! this.timer_state)
                this.timer_duration = this.cache.pomo_duration;

            if (clear_pomo_counter) {
                this.cache.pomo_counter = 0;
                this._store_cache();
                this.pomo_counter_display.text = '';
            }

            this.btn_box_wrapper.actor.show();
            this.button_box.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this._update_time_display();
        }));

        settings.connect('cancel', Lang.bind(this, function () {
            this.btn_box_wrapper.actor.show();
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
        }));
    },

    _maybe_stop_tracking: function () {
        if (! this.settings.get_boolean('pomodoro-stop-tracking'))
            return;

        this.emit('stop-time-tracking');
    },

    _maybe_exec_custom_script: function () {
        if (! this.settings.get_boolean('pomodoro-exec-script'))
            return;

        let script_path = this.settings.get_string('pomodoro-script-path');

        if (script_path) {
            Util.spawnCommandLine(
                script_path.replace(/^.+?\/\//, '') + " " + this.pomo_phase);
        }
    },

    _start: function () {
        this.end_time = GLib.get_monotonic_time() + this.timer_duration;
        this.button_stop.grab_key_focus();
        this.timer_state = true;
        this.pomo_phase  = PomoState.POMO;
        this._toggle_buttons();
        this._panel_item_UI_update();
        if (! this.tic_mainloop_id) this._tic();
        this._maybe_exec_custom_script();
    },

    _stop: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.button_start.grab_key_focus();
        this.timer_state = false;
        this.pomo_phase  = PomoState.STOPPED;
        this._toggle_buttons();
        this._panel_item_UI_update();
        if (this.settings.get_boolean('pomodoro-stop-tracking'))
            this.emit('stop-time-tracking');
        this._maybe_exec_custom_script();
        this._maybe_stop_tracking();
    },

    _start_new_pomo: function () {
        this.timer_state    = true;
        this.timer_duration = this.cache.pomo_duration;
        this.end_time       = GLib.get_monotonic_time() + this.timer_duration;
        this.pomo_phase     = PomoState.POMO;
        this._toggle_buttons();
        this._panel_item_UI_update();
        if (! this.tic_mainloop_id) this._tic();
        this._maybe_exec_custom_script();
    },

    _take_break: function () {
        if (this.cache.pomo_counter &&
            ((this.cache.pomo_counter % this.cache.long_break_rate) === 0)) {

            this.pomo_phase     = PomoState.LONG_BREAK;
            this.timer_duration = this.cache.long_break;
        }
        else {
            this.pomo_phase     = PomoState.SHORT_BREAK;
            this.timer_duration = this.cache.short_break;
        }

        this._maybe_exec_custom_script();
        this._maybe_stop_tracking();
        this.timer_state = true;
        this._toggle_buttons();
        this._panel_item_UI_update();
        if (! this.tic_mainloop_id) this._tic();
        if (this.settings.get_boolean('pomodoro-stop-tracking'))
            this.emit('stop-time-tracking');
    },

    _timer_toggle: function () {
        if (this.timer_state)
            this._stop();
        else
            this._start();
    },

    _panel_item_UI_update: function () {
        if (this.timer_state)
            this.panel_item.actor.add_style_class_name('on');
        else
            this.panel_item.actor.remove_style_class_name('on');
    },

    _toggle_buttons: function () {
        this.button_new_pomo.show();

        if (this.timer_state) {
            this.button_start.hide();
            this.button_stop.show();
        } else {
            this.button_start.show();
            this.button_stop.hide();
        }

        if (this.pomo_phase === PomoState.POMO) {
            this.button_take_break.show();
        }
        else {
            this.button_take_break.hide();
        }
    },

    _timer_expired: function () {
        if (this.pomo_phase === PomoState.LONG_BREAK ||
            this.pomo_phase === PomoState.SHORT_BREAK) {

            this._start_new_pomo();
            this._send_notif();
        }
        else {
            this.cache.pomo_counter += 1;
            this._store_cache();
            this._take_break();
            this._send_notif();
            this.pomo_counter_display.text = '' + this.cache.pomo_counter;
        }
    },

    _tic: function () {
        if (this.timer_duration < 1) {
            this._timer_expired();
        }
        else {
            this.timer_duration = this.end_time - GLib.get_monotonic_time();
            this._update_time_display();
        }

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tic();
        });
    },

    _update_time_display: function () {
        let time = Math.floor(this.timer_duration / 1000000);

        // If the seconds are not shown, we need to make the timer '1-indexed'
        // with respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('pomodoro-show-seconds')) {
            this.header.label.text = "%02d:%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );
        }
        else {
            if (time !== 0 && time !== this.cache.pomo_duration)
                time += 60;

            this.header.label.text = "%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60)
            );
        }

        if (this.panel_item.label.visible)
            this.panel_item.set_label(this.header.label.text);
    },

    _send_notif: function () {
        let msg;

        switch (this.pomo_phase) {
            case PomoState.POMO:        msg = _('Start working!');      break;
            case PomoState.SHORT_BREAK: msg = _('Take a short break!'); break;
            case PomoState.LONG_BREAK:  msg = _('Take long break!');    break;
            default: return;
        }

        let source = new MessageTray.Source();
        Main.messageTray.add(source);

        let icon = new St.Icon();
        ICON_FROM_URI.icon_from_uri(icon, POMODORO_ICON, this.ext_dir);

        let params = {
            bannerMarkup : true,
            gicon        : icon.gicon,
        };

        let sound_file = this.settings.get_string('pomodoro-sound-file-path')
                                      .replace(/^.+?\/\//, '');

        if (this.settings.get_boolean('pomodoro-play-sound') && sound_file) {
            params.soundFile = sound_file;
        }

        let notif = new MessageTray.Notification(source, msg, '', params);

        notif.setUrgency(MessageTray.Urgency.CRITICAL);

        source.notify(notif);
    },

    _update_panel_icon_name: function() {
        ICON_FROM_URI.icon_from_uri(this.panel_item.icon, POMODORO_ICON, this.ext_dir);
    },

    _toggle_panel_mode: function () {
        if (this.settings.get_enum('pomodoro-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('pomodoro-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    },

    _toggle_keybindings: function (disable_all) {
        if (!disable_all &&
            this.settings.get_strv('pomodoro-keybinding-open')[0] !== '') {

            this.keybindings.push('pomodoro-keybinding-open');

            Main.wm.addKeybinding(
                'pomodoro-keybinding-open',
                this.settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => { this.ext.open_menu(this); });
        }
        else {
            let i = this.keybindings.indexOf('pomodoro-keybinding-open');
            if (i !== -1) {
                Main.wm.removeKeybinding('pomodoro-keybinding-open');
                this.keybindings.splice(i, 1);
            }
        }
    },

    _toggle_section: function () {
        if (this.section_enabled) {
            this.panel_item.actor.show();
            this.actor.show();
            this.sigm.connect_all();
            this._init__finish();
        }
        else {
            this.panel_item.actor.hide();
            this.actor.hide();
            this.disable_section();
        }
    },

    disable_section: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.pomo_phase !== PomoState.STOPPED) this._stop();
        this._store_cache();
        this.sigm.disconnect_all();
        this._toggle_keybindings(true);
    },
});
Signals.addSignalMethods(Pomodoro.prototype);



// =====================================================================
// @@@ Pomodoro settings
//
// @signals: 'ok', 'cancel'
// =====================================================================
const PomodoroSettings = new Lang.Class({
    Name: 'Timepp.PomodoroSettings',

    _init: function(pomo_cache) {
        this.actor = new St.BoxLayout({style_class: 'view-box'});

        this.content_box = new St.BoxLayout({vertical: true, style_class: 'view-box-content'});
        this.actor.add(this.content_box, {expand: true});


        //
        // clear all pomodoros
        //
        this.clear_all_item = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.clear_all_item);

        this.clear_item_label = new St.Label({text: _('Clear all pomodoros?'), y_align: Clutter.ActorAlign.CENTER});
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

        this.pomo_label = new St.Label({text: _('Pomodoro (min):'), y_align: Clutter.ActorAlign.CENTER});
        this.pomo_duration.add(this.pomo_label, {expand: true});

        this.pomo_dur_mm_picker = new NUM_PICKER.NumPicker(1, null);
        this.pomo_duration.add_actor(this.pomo_dur_mm_picker.actor);

        this.pomo_dur_mm_picker._set_counter(Math.floor(pomo_cache.pomo_duration / 60000000));


        //
        // short break
        //
        this.short_break = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.short_break);

        this.short_break_label = new St.Label({text: _('Short break (min):'), y_align: Clutter.ActorAlign.CENTER});
        this.short_break.add(this.short_break_label, {expand: true});

        this.short_break_mm_picker = new NUM_PICKER.NumPicker(1, null);
        this.short_break.add_actor(this.short_break_mm_picker.actor);

        this.short_break_mm_picker._set_counter(Math.floor(pomo_cache.short_break / 60000000));


        //
        // long break
        //
        this.long_break = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.long_break);

        this.long_break_label = new St.Label({text: _('Long break (min):'), y_align: Clutter.ActorAlign.CENTER});
        this.long_break.add(this.long_break_label, {expand: true});

        this.long_break_mm_picker = new NUM_PICKER.NumPicker(1, null);
        this.long_break.add_actor(this.long_break_mm_picker.actor);

        this.long_break_mm_picker._set_counter(Math.floor(pomo_cache.long_break / 60000000));


        //
        // how many pomodoros 'till long break
        //
        this.long_break_rate = new St.BoxLayout({style_class: 'row'});
        this.content_box.add_actor(this.long_break_rate);

        this.long_break_rate_label = new St.Label({text: _('Num of pomos until long break:'), y_align: Clutter.ActorAlign.CENTER});
        this.long_break_rate.add(this.long_break_rate_label, {expand: true});

        this.long_break_rate_picker = new NUM_PICKER.NumPicker(1, null);
        this.long_break_rate.add_actor(this.long_break_rate_picker.actor);

        this.long_break_rate_picker._set_counter(pomo_cache.long_break_rate);


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
        this.button_ok.connect('clicked', Lang.bind(this, function() {
            pomo_cache.pomo_duration   = this.pomo_dur_mm_picker.counter * 60000000;
            pomo_cache.short_break     = this.short_break_mm_picker.counter * 60000000;
            pomo_cache.long_break      = this.long_break_mm_picker.counter * 60000000;
            pomo_cache.long_break_rate = this.long_break_rate_picker.counter;

            this.emit('ok', this.clear_item_checkbox.actor.checked);
        }));

        this.button_cancel.connect('clicked', Lang.bind(this, function () {
        this.emit('cancel');
        }));
    },
});
Signals.addSignalMethods(PomodoroSettings.prototype);
