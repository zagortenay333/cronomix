const St             = imports.gi.St;
const Gio            = imports.gi.Gio
const Gtk            = imports.gi.Gtk;
const GLib           = imports.gi.GLib;
const Meta           = imports.gi.Meta;
const Shell          = imports.gi.Shell;
const Pango          = imports.gi.Pango;
const Clutter        = imports.gi.Clutter;
const Main           = imports.ui.main;
const PopupMenu      = imports.ui.popupMenu;
const MessageTray    = imports.ui.messageTray;
const Slider         = imports.ui.slider;
const Lang           = imports.lang;
const Signals        = imports.signals;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const SIG_MANAGER    = ME.imports.lib.signal_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const ICON_FROM_URI = ME.imports.lib.icon_from_uri;
const NUM_PICKER    = ME.imports.lib.num_picker;
const MULTIL_ENTRY  = ME.imports.lib.multiline_entry;


const CACHE_FILE = GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension/timepp_timer.json';
const TIMER_ICON         = '/img/timer-symbolic.svg';
const TIMER_MAX_DURATION = 86400;


const TimerState = {
    RUNNING : 'RUNNING',
    STOPPED : 'STOPPED',
    OFF     : 'OFF',
};


// =====================================================================
// @@@ Main
//
// @ext      : obj    (main extension object)
// @ext_dir  : string (extenstion dir path)
// @settings : obj    (extension settings)
// =====================================================================
const Timer = new Lang.Class({
    Name: 'Timepp.Timer',

    _init: function (ext, ext_dir, settings) {
        this.ext      = ext;
        this.ext_dir  = ext_dir;
        this.settings = settings;


        this.sigm = new SIG_MANAGER.SignalManager();


        this.keybindings     = [];
        this.timer_state     = TimerState.OFF;
        this.timer_duration  = 0; // in seconds
        this.tic_mainloop_id = null;
        this.section_enabled = this.settings.get_boolean('timer-enabled');
        this.separate_menu   = this.settings.get_boolean('timer-separate-menu');
        this.cache_file      = null;
        this.cache           = null;


        //
        // add panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        this.panel_item.set_label(this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        this.panel_item.actor.add_style_class_name('timer-panel-item');
        this._update_panel_icon_name();
        this._toggle_panel_mode();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        //
        // section
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section timer-section', x_expand: true });


        //
        // item with the time display, switcher and settings icon
        //
        this.header = new PopupMenu.PopupMenuItem(_('Timer'), { hover: false, activate: false, style_class: 'header' });
        this.header.actor.can_focus = false;
        this.actor.add_actor(this.header.actor);

        this.option_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, style_class: 'option-box' });
        this.header.actor.add(this.option_box, {expand: true});

        this.toggle = new PopupMenu.Switch('');
        this.toggle_bin = new St.Button({ y_align: St.Align.MIDDLE });
        this.toggle_bin.add_actor(this.toggle.actor);
        this.option_box.add(this.toggle_bin);

        this.toggle.actor.can_focus = false;
        this.toggle_bin.hide();

        this.settings_icon = new St.Icon({ icon_name: 'open-menu-symbolic' });
        this.settings_bin  = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'settings-icon' });
        this.settings_bin.add_actor(this.settings_icon);
        this.option_box.add(this.settings_bin);


        //
        // timer slider
        //
        this.slider_item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        this.actor.add_actor(this.slider_item.actor);

        this.slider = new Slider.Slider(0);
        this.slider_item.actor.add(this.slider.actor, { expand: true });


        //
        // settings window container
        //
        this.timepicker_container = new St.Bin({ x_fill: true });
        this.actor.add_child(this.timepicker_container);


        //
        // listen
        //
        this.settings.connect('changed::timer-enabled', () => {
            this.section_enabled = this.settings.get_boolean('timer-enabled');
            this._toggle_section();
        }); // don't put this signal into the signal manager

        this.sigm.connect(this.settings, 'changed::timer-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('timer-separate-menu');
        });
        this.sigm.connect(this.settings, 'changed::timer-show-seconds', () => {
            this._update_time_display();
        });
        this.sigm.connect(this.settings, 'changed::timer-panel-mode', () => {
            this._toggle_panel_mode();
        });
        this.sigm.connect(this.settings, 'changed::timer-keybinding-open', () => {
            this._toggle_keybindings();
        });
        this.sigm.connect(this.panel_item, 'click', Lang.bind(this, function () {
            this.emit('toggle-menu');
        }));
        this.sigm.connect(this.panel_item, 'middle-click', Lang.bind(this, this._timer_toggle));
        this.sigm.connect(this.toggle_bin, 'clicked', Lang.bind(this, this._timer_toggle));
        this.sigm.connect(this.settings_bin, 'clicked', Lang.bind(this, this._show_settings));
        this.sigm.connect(this.slider, 'value-changed', Lang.bind(this, this._slider_changed));
        this.sigm.connect(this.slider, 'drag-end', Lang.bind(this, this._slider_released));
        this.sigm.connect(this.slider.actor, 'scroll-event', Lang.bind(this, this._slider_released));
        this.sigm.connect(this.slider_item.actor, 'button-press-event', Lang.bind(this, function(actor, event) {
            return this.slider.startDragging(event);
        }));
        this.sigm.connect(this.slider_item.actor, 'key-press-event', Lang.bind(this, function(actor, event) {
            return this.slider.onKeyPressEvent(actor, event);
        }));


        if (this.section_enabled) this._init__finish();
        else                      this.sigm.disconnect_all();
    },

    _init__finish: function () {
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            if (this.cache_file.query_exists(null)) {
                let [a, contents, b] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }
            else {
                this.cache = {
                    notif_msg: '',
                };
            }
        } catch (e) { logError(e); }

        this._toggle_keybindings();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    _start: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.timer_state = TimerState.RUNNING;
        this.toggle.setToggleState('checked');
        this.toggle_bin.show();
        this.toggle.actor.reactive  = true;
        this.toggle.actor.can_focus = true;
        this._tic();
        this._panel_item_UI_update();
    },

    _stop: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.timer_state = TimerState.STOPPED;
        this.toggle.setToggleState('');
        this._panel_item_UI_update();
    },

    _off: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.timer_state = TimerState.OFF;
        this.header.label.text = _('Timer');
        this.toggle_bin.hide();
        this.toggle.actor.reactive  = false;
        this.toggle.actor.can_focus = false;
        this._panel_item_UI_update();
    },

    _expired: function () {
        this._send_notif();
        this._off();
    },

    _timer_toggle: function () {
        if (this.timer_state === TimerState.STOPPED)
            this._start();
        else if (this.timer_state === TimerState.RUNNING)
            this._stop();
        else
            return;

        this._panel_item_UI_update();
    },

    _panel_item_UI_update: function () {
        if (this.timer_state === TimerState.RUNNING)
            this.panel_item.actor.add_style_class_name('on');
        else
            this.panel_item.actor.remove_style_class_name('on');
    },

    _tic: function () {
        if (this.timer_duration < 1) {
            this._expired();
        }
        else {
            this.timer_duration -= 1;
            this._slider_update();
            this._update_time_display();

            this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
                this._tic();
            });
        }
    },

    _slider_released: function () {
        if (!this.timer_duration)
            this._off();
        else
            this._start();
    },

    _slider_changed: function (slider, value) {
        this._stop();

        if (value < 1) {
            // Make rate of change of the timer duration an exponential curve.
            // This allows for finer tuning when the duration is smaller.
            let y = (Math.pow(2, (10 * value)) - 1) / (Math.pow(2, 10) - 1);

            // Change the increment of the slider based on how far it's dragged.
            // If the seconds are not shown, the increments must be multiples
            // of 60s.
            let step;
            if (this.settings.get_boolean('timer-show-seconds')) {
                if      (value < .05) step = 15;
                else if (value < .5)  step = 30;
                else if (value < .8)  step = 60;
                else                  step = 3600;
            } else {
                if      (value < .7)  step = 59;
                else if (value < .9)  step = 1800;
                else                  step = 3600;
            }

            this.timer_duration = Math.floor(y * TIMER_MAX_DURATION / step) * step;
            this._update_time_display();
        } else {
            // fix for when the slider has been dragged past the limit
            this.timer_duration = TIMER_MAX_DURATION;
            this._update_time_display();
        }
    },

    _slider_update: function () {
        // Update slider based on the timer_duration.
        // Use this when the timer_duration changes without using the slider.
        // This function is the inverse of the function that is used to calc the
        // timer_duration based on the slider.
        let x = this.timer_duration / TIMER_MAX_DURATION;
        let y = (Math.log(x * (Math.pow(2, 10) - 1) +1)) / Math.log(2) / 10;
        this.slider.setValue(y);
    },

    _update_time_display: function () {
        // If the seconds are not shown, we need to make the timer '1-indexed'
        // in respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('timer-show-seconds')) {
            let time = this.timer_duration;

            let hr  = Math.floor(time / 3600);
            let min = Math.floor(time % 3600 / 60);
            let sec = time % 60;

            this.header.label.text = "%02d:%02d:%02d".format(hr, min, sec);
        }
        else {
            let time = this.timer_duration;

            if (time % 3600 !== 0) time += 60;

            let hr  = Math.floor(time / 3600);
            let min = Math.floor(time % 3600 / 60);

            this.header.label.text = "%02d:%02d".format(hr, min);
        }

        if (this.panel_item.label.visible)
            this.panel_item.set_label(this.header.label.text);
    },

    _send_notif: function () {
        let source = new MessageTray.Source();
        Main.messageTray.add(source);

        let icon = new St.Icon();
        ICON_FROM_URI.icon_from_uri(icon, TIMER_ICON, this.ext_dir);

        let params = {
            bannerMarkup : true,
            gicon        : icon.gicon,
        };

        let sound_file = this.settings.get_string('timer-sound-file-path')
                                      .replace(/^.+?\/\//, '');

        if (this.settings.get_boolean('timer-play-sound') && sound_file) {
            params.soundFile = sound_file;
        }

        let notif = new MessageTray.Notification(source,
                                                 _('Timer expired!'),
                                                 this.cache.notif_msg,
                                                 params);

        notif.setUrgency(MessageTray.Urgency.CRITICAL);

        source.notify(notif);
    },

    _show_settings: function () {
        let settings = new TimerSettings(this.ext,
            this.settings.get_boolean('timer-show-seconds'), this.cache.notif_msg);

        this.timepicker_container.add_actor(settings.actor);
        settings.button_cancel.grab_key_focus();

        this.header.actor.hide();
        this.slider_item.actor.hide();

        settings.connect('ok', Lang.bind(this, function (actor, time, notif_msg) {
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this.slider_item.actor.show();

            this.cache.notif_msg = notif_msg;
            this._store_cache();

            if (time) {
                this.timer_duration = time;
                this._slider_update();
                this._start();
            }
        }));

        settings.connect('cancel', Lang.bind(this, function () {
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this.slider_item.actor.show();
        }));
    },

    _update_panel_icon_name: function() {
        ICON_FROM_URI.icon_from_uri(this.panel_item.icon, TIMER_ICON, this.ext_dir);
    },

    _toggle_panel_mode: function () {
        if (this.settings.get_enum('timer-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('timer-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    },

    _toggle_keybindings: function (disable_all) {
        if (!disable_all &&
            this.settings.get_strv('timer-keybinding-open')[0] !== '') {

            this.keybindings.push('timer-keybinding-open');

            Main.wm.addKeybinding(
                'timer-keybinding-open',
                this.settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => { this.ext.open_menu(this); });
        }
        else {
            let i = this.keybindings.indexOf('timer-keybinding-open');
            if (i !== -1) {
                Main.wm.removeKeybinding('timer-keybinding-open');
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
        this._stop();
        this._store_cache();
        this.sigm.disconnect_all();
        this._toggle_keybindings(true);
    },
});
Signals.addSignalMethods(Timer.prototype);



// =====================================================================
// @@@ Settings window
//
// @ext       : ext class
// @show_secs : bool
// @notif_msg : string
//
// signals: 'ok', 'cancel'
// =====================================================================
const TimerSettings = new Lang.Class({
    Name: 'Timepp.TimerSettings',

    _init: function(ext, show_secs, notif_msg) {
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // time pickers
        //
        this.alarms_numpicker_box = new St.BoxLayout({ style_class: 'row numpicker-box' });
        this.content_box.add_actor(this.alarms_numpicker_box);

        this.hr_bin = new St.Bin({x_align: 1});
        this.alarms_numpicker_box.add(this.hr_bin, {expand: true});
        this.hr  = new NUM_PICKER.NumPicker(0, 23);
        this.hr_bin.add_actor(this.hr.actor);

        this.min_bin = new St.Bin({x_align: 1});
        this.alarms_numpicker_box.add(this.min_bin, {expand: true});
        this.min = new NUM_PICKER.NumPicker(0, 59);
        this.min_bin.add_actor(this.min.actor);

        if (show_secs) {
            this.sec_bin = new St.Bin({x_align: 1});
            this.alarms_numpicker_box.add(this.sec_bin, {expand: true});
            this.sec = new NUM_PICKER.NumPicker(0, 59);
            this.sec_bin.add_actor(this.sec.actor);
        }


        //
        // entry
        //
        this.entry_container = new St.BoxLayout({ x_expand: true, style_class: 'row entry-container' });
        this.content_box.add_actor(this.entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Timer message...'), true);
        this.entry_container.add(this.entry.actor, {expand: true});

        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;

        // fill entry with notif_msg
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            this.entry.entry.set_text(notif_msg);
        }));

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            this.entry._resize_entry();
        }));


        //
        // buttons
        //
        let alarms_settings_btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add(alarms_settings_btn_box, {expand: true});

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'button', x_expand: true });
        this.button_ok     = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'button', x_expand: true });
        alarms_settings_btn_box.add(this.button_cancel, {expand: true});
        alarms_settings_btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', Lang.bind(this, function () {
            this.emit('ok', this._get_time(), this.entry.entry.get_text());
        }));
        this.button_cancel.connect('clicked', Lang.bind(this, function () {
            this.emit('cancel');
        }));
        this.entry.entry.connect('queue-redraw', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (ext.needs_scrollbar())
                this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    _get_time: function () {
        let hr  = this.hr.counter * 3600;
        let min = this.min.counter * 60;
        let sec = this.sec ? this.sec.counter : 0;

        return hr + min + sec;
    },
});
Signals.addSignalMethods(TimerSettings.prototype);
