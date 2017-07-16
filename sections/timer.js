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


const Gettext = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FULLSCREEN    = ME.imports.lib.fullscreen;
const SIG_MANAGER   = ME.imports.lib.signal_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const ICON_FROM_URI = ME.imports.lib.icon_from_uri;
const NUM_PICKER    = ME.imports.lib.num_picker;
const MULTIL_ENTRY  = ME.imports.lib.multiline_entry;


const CACHE_FILE = GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension/timepp_timer.json';
const TIMER_ICON         = '/img/timer-symbolic.svg';
const TIMER_MAX_DURATION = 86400000000; // 24 hours in microseconds
const TIMER_EXPIRED_MSG  = _('Timer Expired!');


const TimerState = {
    RUNNING : 'RUNNING',
    STOPPED : 'STOPPED',
    OFF     : 'OFF',
};

const NotifStyle = {
    STANDARD   : 0,
    FULLSCREEN : 1,
};


// =====================================================================
// @@@ Main
//
// @ext      : obj    (main extension object)
// @ext_dir  : string (extension dir path)
// @settings : obj    (extension settings)
// =====================================================================
const Timer = new Lang.Class({
    Name: 'Timepp.Timer',

    _init: function (ext, ext_dir, settings) {
        this.ext      = ext;
        this.ext_dir  = ext_dir;
        this.settings = settings;

        this.sigm = new SIG_MANAGER.SignalManager();

        this.section_enabled = this.settings.get_boolean('timer-enabled');
        this.separate_menu   = this.settings.get_boolean('timer-separate-menu');
        this.timer_state     = TimerState.OFF;
        this.timer_duration  = 0; // in microseconds
        this.end_time        = 0; // used for computing elapsed time
        this.keybindings     = [];
        this.tic_mainloop_id = null;
        this.cache_file      = null;
        this.cache           = null;

        this.fullscreen = new TimerFullscreen(
            this.ext, this, this.settings.get_int('timer-fullscreen-monitor-pos'));

        this.fullscreen.set_banner_text(
            this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');


        //
        // add panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        this.panel_item.set_label(this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        this.panel_item.actor.add_style_class_name('timer-panel-item');
        this._update_panel_icon_name();
        this._toggle_panel_item_mode();

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
        this.header.label.add_style_class_name('clock');
        this.actor.add_actor(this.header.actor);

        this.option_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, style_class: 'option-box' });
        this.header.actor.add(this.option_box, {expand: true});

        this.toggle = new PopupMenu.Switch('');
        this.toggle_bin = new St.Button({ visible: false, can_focus: true, y_align: St.Align.MIDDLE });
        this.toggle_bin.add_actor(this.toggle.actor);
        this.option_box.add(this.toggle_bin);

        this.fullscreen_bin  = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'fullscreen-icon' });
        this.option_box.add(this.fullscreen_bin);
        this.fullscreen_icon = new St.Icon({ icon_name: 'view-fullscreen-symbolic' });
        this.fullscreen_bin.add_actor(this.fullscreen_icon);

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
            this.toggle_section();
            this.section_enabled = this.settings.get_boolean('timer-enabled');
        }); // don't put this signal into the signal manager

        this.sigm.connect(this.fullscreen, 'monitor-changed', () => {
            this.settings.set_int('timer-fullscreen-monitor-pos', this.fullscreen.monitor);
        });
        this.sigm.connect(this.settings, 'changed::timer-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('timer-separate-menu');
        });
        this.sigm.connect(this.settings, 'changed::timer-show-seconds', () => {
            this._update_time_display();
        });
        this.sigm.connect(this.settings, 'changed::timer-panel-mode', () => {
            this._toggle_panel_item_mode();
        });
        this.sigm.connect(this.settings, 'changed::timer-keybinding-open', () => {
            this._toggle_keybindings();
        });
        this.sigm.connect(this.panel_item.actor, 'key-focus-in', () => {
            // user has right-clicked to show the context menu
            if (this.ext.menu.isOpen && this.ext.context_menu.actor.visible)
                return;

            this.ext.open_menu(this);
        });
        this.sigm.connect(this.panel_item, 'left-click', () => { this.ext.toggle_menu(this); });
        this.sigm.connect(this.panel_item, 'right-click', () => { this.ext.toggle_context_menu(this); });
        this.sigm.connect(this.panel_item, 'middle-click', Lang.bind(this, this.toggle_timer));
        this.sigm.connect(this.toggle_bin, 'clicked', Lang.bind(this, this.toggle_timer));
        this.sigm.connect(this.fullscreen_bin, 'clicked', Lang.bind(this, this._show_fullscreen));
        this.sigm.connect(this.settings_bin, 'clicked', Lang.bind(this, this._show_settings));
        this.sigm.connect(this.slider, 'value-changed', Lang.bind(this, this.slider_changed));
        this.sigm.connect(this.slider, 'drag-end', Lang.bind(this, this.slider_released));
        this.sigm.connect(this.slider.actor, 'scroll-event', Lang.bind(this, this.slider_released));
        this.sigm.connect(this.slider_item.actor, 'button-press-event', Lang.bind(this, function(actor, event) {
            this.slider.startDragging(event);
        }));


        if (this.section_enabled) this.enable_section();
        else                      this.sigm.disconnect_all();
    },

    on_section_open_state_changed: function (state) {
        if (state) {
            this.panel_item.actor.add_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = false;
        }
        else {
            this.panel_item.actor.remove_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = true;
        }

        this.emit('section-open-state-changed', state);
    },

    toggle_section: function () {
        if (this.section_enabled) {
            this.panel_item.actor.hide();
            this.disable_section();
        }
        else {
            if (!this.ext.unicon_panel_item.actor.visible)
                this.panel_item.actor.show();
            this.sigm.connect_all();
            this.enable_section();
        }
    },

    disable_section: function () {
        this.stop_timer();
        this._store_cache();
        this.sigm.disconnect_all();
        this._toggle_keybindings(true);
        this.fullscreen.destroy();
        this.fullscreen = null;
    },

    enable_section: function () {
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            if (this.cache_file.query_exists(null)) {
                let [a, contents, b] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }
            else {
                this.cache = {
                    notif_msg: '',
                    last_manually_set_time: 30000000,
                };
            }
        } catch (e) { logError(e); }

        if (! this.fullscreen)
            this.fullscreen = new TimerFullscreen(
                this.ext, this, this.settings.get_int('timer-fullscreen-monitor-pos'));

        this._toggle_keybindings();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    toggle_timer: function () {
        if (this.timer_state === TimerState.STOPPED)
            this.start_timer();
        else if (this.timer_state === TimerState.RUNNING)
            this.stop_timer();
        else
            return;
    },

    start_timer: function (time) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.timer_duration = time || this.timer_duration;
        this.end_time       = GLib.get_monotonic_time() + this.timer_duration;

        this.timer_state = TimerState.RUNNING;

        this._update_time_display();
        this._tic();

        this.fullscreen.on_timer_started();
        this.toggle.setToggleState('checked');
        this.toggle_bin.show();
        this.panel_item.actor.add_style_class_name('on');
    },

    stop_timer: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.fullscreen.on_timer_stopped();
        this.timer_state = TimerState.STOPPED;
        this.toggle.setToggleState('');
        this.panel_item.actor.remove_style_class_name('on');
    },

    off_timer: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.fullscreen.on_timer_off();
        this.timer_state = TimerState.OFF;
        this.header.label.text = _('Timer');
        this.toggle_bin.hide();
        this.panel_item.actor.remove_style_class_name('on');
    },

    _on_timer_expired: function () {
        this.off_timer();
        this.fullscreen.on_timer_expired();
        this._send_notif();
    },

    _tic: function () {
        this._update_slider();
        this._update_time_display();

        if (this.timer_duration < 1000000) {
            this.timer_duration = 0;
            this._on_timer_expired();
            return;
        }

        this.timer_duration = this.end_time - GLib.get_monotonic_time();

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tic();
        });
    },

    _update_panel_icon_name: function() {
        ICON_FROM_URI.icon_from_uri(this.panel_item.icon, TIMER_ICON, this.ext_dir);
    },

    _update_time_display: function () {
        let time = Math.floor(this.timer_duration / 1000000);

        // If the seconds are not shown, we need to make the timer '1-indexed'
        // in respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('timer-show-seconds')) {
            this.header.label.text = "%02d:%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );
        }
        else {
            if (time % 3600 !== 0) time += 60;

            this.header.label.text = "%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60)
            );
        }

        this.panel_item.set_label(this.header.label.text);
        this.fullscreen.set_banner_text(this.header.label.text);
    },

    _update_slider: function () {
        // Update slider based on the timer_duration.
        // Use this when the timer_duration changes without using the slider.
        // This function is the inverse of the function that is used to calc the
        // timer_duration based on the slider.
        let x = this.timer_duration / TIMER_MAX_DURATION;
        let y = (Math.log(x * (Math.pow(2, 10) - 1) +1)) / Math.log(2) / 10;
        this.slider.setValue(y);
        this.fullscreen.slider.setValue(y);
    },

    _update_time_display: function () {
        let time = Math.floor(this.timer_duration / 1000000);

        // If the seconds are not shown, we need to make the timer '1-indexed'
        // in respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('timer-show-seconds')) {
            this.header.label.text = "%02d:%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );
        }
        else {
            if (time % 3600 !== 0) time += 60;

            this.header.label.text = "%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60)
            );
        }

        this.panel_item.set_label(this.header.label.text);
        this.fullscreen.set_banner_text(this.header.label.text);
    },

    slider_released: function () {
        if (this.timer_duration < 1000000) {
            this.off_timer();
        }
        else {
            this.start_timer();
            this.cache.last_manually_set_time = this.timer_duration;
            this._store_cache();
        }
    },

    slider_changed: function (slider, value) {
        this.stop_timer();

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
            }
            else {
                if      (value < .7)  step = 59;
                else if (value < .9)  step = 1800;
                else                  step = 3600;
            }

            this.timer_duration =
                Math.floor(y * TIMER_MAX_DURATION / step) * step;

            this._update_time_display();
        }
        else { // slider has been dragged past the limit
            this.timer_duration = TIMER_MAX_DURATION;
            this._update_time_display();
        }
    },

    _send_notif: function () {
        let sound_file = this.settings.get_string('timer-sound-file-path')
                                      .replace(/^.+?\/\//, '');

        if (this.settings.get_boolean('timer-play-sound') && sound_file) {
            global.play_sound_file(0, sound_file, 'timer-notif', null);
        }

        if (this.settings.get_enum('timer-notif-style') === NotifStyle.FULLSCREEN) {
            this.fullscreen.open();
            return;
        }

        if (this.fullscreen.is_open)
            return;

        let source = new MessageTray.Source();
        Main.messageTray.add(source);

        let icon = new St.Icon();
        ICON_FROM_URI.icon_from_uri(icon, TIMER_ICON, this.ext_dir);

        let params = {
            bannerMarkup : true,
            gicon        : icon.gicon,
        };

        let notif = new MessageTray.Notification(source,
                                                 TIMER_EXPIRED_MSG,
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

        settings.connect('ok', (actor, time, notif_msg) => {
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this.slider_item.actor.show();

            this.cache.notif_msg = notif_msg;
            this._store_cache();

            if (time) {
                this.timer_duration = time;
                this.start_timer();
                this._update_slider();
                this.cache.last_manually_set_time = time;
                this._store_cache();
            }
        });

        settings.connect('cancel', () => {
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this.slider_item.actor.show();
        });
    },

    _show_fullscreen: function () {
        this.ext.menu.close();

        if (! this.fullscreen) {
            this.fullscreen = new TimerFullscreen(
                this.ext, this, this.settings.get_int('timer-fullscreen-monitor-pos'));
        }

        this.fullscreen.open();
    },

    _toggle_panel_item_mode: function () {
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
        } else {
            let i = this.keybindings.indexOf('timer-keybinding-open');
            if (i !== -1) {
                Main.wm.removeKeybinding('timer-keybinding-open');
                this.keybindings.splice(i, 1);
            }
        }

        if (!disable_all &&
            this.settings.get_strv('timer-keybinding-open-fullscreen')[0] !== '') {

            this.keybindings.push('timer-keybinding-open-fullscreen');

            Main.wm.addKeybinding(
                'timer-keybinding-open-fullscreen',
                this.settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => { this._show_fullscreen(); });
        } else {
            let i = this.keybindings.indexOf('timer-keybinding-open-fullscreen');
            if (i !== -1) {
                Main.wm.removeKeybinding('timer-keybinding-open-fullscreen');
                this.keybindings.splice(i, 1);
            }
        }
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
        this.button_ok.connect('clicked', () => {
            this.emit('ok', this._get_time(), this.entry.entry.get_text());
        })
        this.button_cancel.connect('clicked', () => {
            this.emit('cancel');
        });
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

        return (hr + min + sec) * 1000000;
    },
});
Signals.addSignalMethods(TimerSettings.prototype);



// =====================================================================
// @@@ Timer fullscreen interface
//
// @ext       : ext class
// @show_secs : bool
// @monitor   : int
//
// signals: 'monitor-changed'
// =====================================================================
const TimerFullscreen = new Lang.Class({
    Name    : 'Timepp.TimerFullscreen',
    Extends : FULLSCREEN.Fullscreen,

    _init: function (ext, delegate, monitor) {
        this.parent(monitor);

        this.ext      = ext;
        this.delegate = delegate;

        this.default_style_class = this.actor.style_class;

        this.slider = new Slider.Slider(0);
        this.bottom_box.add_child(this.slider.actor);
        this.slider.actor.can_focus = true;


        this.toggle_bin = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE });
        this.top_box.insert_child_at_index(this.toggle_bin, 0);
        this.toggle_bin.hide();

        this.toggle = new PopupMenu.Switch('');
        this.toggle_bin.add_actor(this.toggle.actor);


        //
        // listen
        //
        this.toggle_bin.connect('clicked', () => {
            this.delegate.toggle_timer();
        });
        this.slider.connect('drag-end', () => {
            this.delegate.slider_released();
        });
        this.slider.actor.connect('scroll-event', () => {
            this.delegate.slider_released();
        });
        this.slider.connect('value-changed', (slider, val) => {
            this.delegate.slider_changed(slider, val);
            this.actor.remove_style_class_name('timer-expired');
        });
        this.actor.connect('key-release-event', (_, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_space:
                    if (this.delegate.timer_state !== TimerState.OFF)
                        this.delegate.toggle_timer();
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_r:
                case Clutter.KEY_BackSpace:
                    this.delegate.start_timer(this.delegate.cache.last_manually_set_time);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_1:
                    this.delegate.start_timer(60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_2:
                    this.delegate.start_timer(2 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_3:
                    this.delegate.start_timer(3 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_4:
                    this.delegate.start_timer(4 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_5:
                    this.delegate.start_timer(5 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_6:
                    this.delegate.start_timer(6 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_7:
                    this.delegate.start_timer(7 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_8:
                    this.delegate.start_timer(8 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_9:
                    this.delegate.start_timer(9 * 60000000);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_0:
                    this.delegate.start_timer(10 * 60000000);
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }
        });
    },

    close: function () {
        if (this.delegate.timer_state === TimerState.OFF) {
            this.actor.style_class = this.default_style_class;
            this.set_banner_text(
                this.delegate.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        }

        this.parent();
    },

    on_timer_started: function () {
        this.actor.style_class = this.default_style_class;
        this.toggle.setToggleState('checked');
        this.toggle_bin.show();
    },

    on_timer_stopped: function () {
        this.actor.style_class = this.default_style_class + ' timer-stopped';
        this.toggle.setToggleState('');
    },

    on_timer_off: function () {
        this.toggle_bin.hide();
    },

    on_timer_expired: function () {
        let msg = this.delegate.cache.notif_msg ? '\n\n' + this.delegate.cache.notif_msg : '';
        this.set_banner_text(TIMER_EXPIRED_MSG + msg);
        this.actor.style_class = this.default_style_class + ' timer-expired';
    },
});
Signals.addSignalMethods(TimerFullscreen.prototype);
