const St          = imports.gi.St;
const Gio         = imports.gi.Gio
const Gtk         = imports.gi.Gtk;
const GLib        = imports.gi.GLib;
const Meta        = imports.gi.Meta;
const Shell       = imports.gi.Shell;
const Pango       = imports.gi.Pango;
const Clutter     = imports.gi.Clutter;
const Main        = imports.ui.main;
const PopupMenu   = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;
const Slider      = imports.ui.slider;
const Lang        = imports.lang;
const Signals     = imports.signals;
const Mainloop    = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FULLSCREEN    = ME.imports.lib.fullscreen;
const SIG_MANAGER   = ME.imports.lib.signal_manager;
const KEY_MANAGER   = ME.imports.lib.keybinding_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const NUM_PICKER    = ME.imports.lib.num_picker;
const MULTIL_ENTRY  = ME.imports.lib.multiline_entry;


const IFACE = `${ME.path}/dbus/timer_iface.xml`;

const CACHE_FILE = GLib.get_home_dir() +
                   '/.cache/timepp_gnome_shell_extension/timepp_timer.json';

const TIMER_MAX_DURATION = 86400; // 24 hours in seconds
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
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
// =====================================================================
var Timer = new Lang.Class({
    Name: 'Timepp.Timer',

    _init: function (ext, settings) {
        this.ext      = ext;
        this.settings = settings;


        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + xml;
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
        }


        this.section_enabled = this.settings.get_boolean('timer-enabled');
        this.separate_menu   = this.settings.get_boolean('timer-separate-menu');
        this.timer_state     = TimerState.OFF;
        this.clock           = 0; // in seconds
        this.end_time        = 0; // for computing elapsed time (microseconds)
        this.tic_mainloop_id = null;
        this.cache_file      = null;
        this.cache           = null;


        this.fullscreen = new TimerFullscreen(this.ext, this,
            this.settings.get_int('timer-fullscreen-monitor-pos'));

        this.fullscreen.set_banner_text(
            this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');


        this.sigm = new SIG_MANAGER.SignalManager();
        this.keym = new KEY_MANAGER.KeybindingManager(this.settings);


        //
        // register shortcuts (need to be enabled later on)
        //
        this.keym.register('timer-keybinding-open', () => {
             this.ext.open_menu(this);
        });
        this.keym.register('timer-keybinding-open-fullscreen', () => {
            this.show_fullscreen();
        });


        //
        // add panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);
        this.panel_item.icon.icon_name = 'timepp-timer-symbolic';

        this.panel_item.set_label(this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        this.panel_item.actor.add_style_class_name('timer-panel-item');

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

        this.icon_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.actor.add(this.icon_box, {expand: true});

        this.toggle = new PopupMenu.Switch('');
        this.toggle_bin = new St.Button({ visible: false, can_focus: true, y_align: St.Align.MIDDLE });
        this.toggle_bin.add_actor(this.toggle.actor);
        this.icon_box.add(this.toggle_bin);

        this.fullscreen_bin  = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'fullscreen-icon' });
        this.icon_box.add(this.fullscreen_bin);
        this.fullscreen_icon = new St.Icon({ icon_name: 'timepp-fullscreen-symbolic' });
        this.fullscreen_bin.add_actor(this.fullscreen_icon);

        this.settings_icon = new St.Icon({ icon_name: 'timepp-settings-symbolic' });
        this.settings_bin  = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'settings-icon' });
        this.settings_bin.add_actor(this.settings_icon);
        this.icon_box.add(this.settings_bin);



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
        this.sigm.connect(this.fullscreen, 'monitor-changed', () => {
            this.settings.set_int('timer-fullscreen-monitor-pos', this.fullscreen.monitor);
        });
        this.sigm.connect(this.settings, 'changed::timer-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('timer-separate-menu');
            this.ext.update_panel_items();
        });
        this.sigm.connect(this.settings, 'changed::timer-show-seconds', () => {
            this._update_time_display();
        });
        this.sigm.connect(this.settings, 'changed::timer-panel-mode', () => {
            this._toggle_panel_item_mode();
        });
        this.sigm.connect(this.panel_item.actor, 'key-focus-in', () => {
            // user has right-clicked to show the context menu
            if (this.ext.menu.isOpen && this.ext.context_menu.actor.visible)
                return;

            this.ext.open_menu(this);
        });
        this.sigm.connect(this.panel_item, 'left-click', () => { this.ext.toggle_menu(this); });
        this.sigm.connect(this.panel_item, 'right-click', () => { this.ext.toggle_context_menu(this); });
        this.sigm.connect(this.panel_item, 'middle-click', () => this.toggle_timer());
        this.sigm.connect_press(this.toggle_bin, () => this.toggle_timer());
        this.sigm.connect_press(this.fullscreen_bin, () => this.show_fullscreen());
        this.sigm.connect_press(this.settings_bin, () => this._show_settings());
        this.sigm.connect(this.slider, 'value-changed', (slider, value) => this.slider_changed(slider, value));
        this.sigm.connect(this.slider, 'drag-end', () => this.slider_released());
        this.sigm.connect(this.slider.actor, 'scroll-event', () => this.slider_released());
        this.sigm.connect(this.slider_item.actor, 'button-press-event', (_, event) => this.slider.startDragging(event));

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
            this.disable_section();
        }
        else {
            this.sigm.connect_all();
            this.enable_section();
        }

        this.section_enabled = this.settings.get_boolean('timer-enabled');
        this.ext.update_panel_items();
    },

    disable_section: function () {
        this.dbus_impl.unexport();
        this.stop();
        this._store_cache();
        this.sigm.clear();
        this.keym.disable_all();

        if (this.fullscreen) {
            this.fullscreen.destroy();
            this.fullscreen = null;
        }
    },

    enable_section: function () {
        // init cache file
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].timer;

            if (this.cache_file.query_exists(null)) {
                let [a, contents, b] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                this.cache = {
                    format_version         : cache_format_version,
                    notif_msg              : '',
                    last_manually_set_time : 30, // in seconds
                };
            }
        }
        catch (e) {
            logError(e);
            return;
        }

        if (! this.fullscreen)
            this.fullscreen = new TimerFullscreen(
                this.ext, this, this.settings.get_int('timer-fullscreen-monitor-pos'));

        this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/Timer');
        this.keym.enable_all();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    toggle_timer: function () {
        if      (this.timer_state === TimerState.STOPPED) this.start();
        else if (this.timer_state === TimerState.RUNNING) this.stop();
    },

    // @time: int (seconds)
    start: function (time = 0) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.timer_state = TimerState.RUNNING;
        this.clock       = Math.min(time, TIMER_MAX_DURATION) || this.clock;
        this.end_time    = GLib.get_monotonic_time() + (this.clock * 1000000);

        this._update_time_display();
        this.fullscreen.on_timer_started();
        this.toggle.setToggleState('checked');
        this.toggle_bin.show();
        this.panel_item.actor.add_style_class_name('on');

        this._tic();
    },

    stop: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.fullscreen.on_timer_stopped();
        this.timer_state = TimerState.STOPPED;
        this.toggle.setToggleState('');
        this.panel_item.actor.remove_style_class_name('on');
    },

    reset: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.slider.setValue(0);
        this.fullscreen.on_timer_off();
        this.timer_state = TimerState.OFF;
        this.header.label.text = _('Timer');
        this.toggle_bin.hide();
        this.panel_item.actor.remove_style_class_name('on');
    },

    _on_timer_expired: function () {
        this.reset();
        this.fullscreen.on_timer_expired();
        this._send_notif();
        this.dbus_impl.emit_signal('timer_expired', null);
    },

    _tic: function () {
        this._update_slider();
        this._update_time_display();

        if (this.clock < 1) {
            this.clock = 0;
            this._on_timer_expired();
            return;
        }

        this.clock =
            Math.floor((this.end_time - GLib.get_monotonic_time()) / 1000000)

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tic();
        });
    },

    _update_time_display: function () {
        let time = this.clock;

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
        // Update slider based on the clock.
        // Use this when the clock changes without using the slider.
        // This function is the inverse of the function that is used to calc the
        // clock based on the slider.
        let x = this.clock / TIMER_MAX_DURATION;
        let y = (Math.log(x * (Math.pow(2, 10) - 1) +1)) / Math.log(2) / 10;
        this.slider.setValue(y);
        this.fullscreen.slider.setValue(y);
    },

    _update_time_display: function () {
        let time = this.clock;

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
        if (this.clock < 1) {
            this.reset();
        }
        else {
            this.start();
            this.cache.last_manually_set_time = this.clock;
            this._store_cache();
        }
    },

    slider_changed: function (slider, value) {
        this.stop();

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

            this.clock = Math.floor(y * TIMER_MAX_DURATION / step) * step;

            this._update_time_display();
        }
        else { // slider has been dragged past the limit
            this.clock = TIMER_MAX_DURATION;
            this._update_time_display();
        }
    },

    _send_notif: function () {
        if (this.settings.get_boolean('timer-play-sound')) {
            let sound_file = this.settings.get_string('timer-sound-file-path');

            if (sound_file) {
                [sound_file,] = GLib.filename_from_uri(sound_file, null);
                global.play_sound_file(0, sound_file, '', null);
            }
        }

        if (this.settings.get_enum('timer-notif-style') === NotifStyle.FULLSCREEN) {
            this.fullscreen.open();
            return;
        }

        if (this.fullscreen.is_open)
            return;

        let source = new MessageTray.Source();
        Main.messageTray.add(source);

        let icon = new St.Icon({ icon_name: 'timepp-timer-symbolic' });

        let params = {
            bannerMarkup : true,
            gicon        : icon.gicon,
        };

        let notif = new MessageTray.Notification(
            source,
            TIMER_EXPIRED_MSG,
            this.cache.notif_msg,
            params
        );

        notif.setUrgency(MessageTray.Urgency.CRITICAL);

        source.notify(notif);
    },

    _show_settings: function () {
        let settings = new TimerSettings(
            this.ext,
            this,
            this.settings.get_boolean('timer-show-seconds'),
            this.cache.notif_msg
        );

        this.timepicker_container.add_actor(settings.actor);
        settings.button_cancel.grab_key_focus();

        this.header.actor.hide();
        this.slider_item.actor.hide();

        settings.connect('ok', (actor, time, notif_msg) => {
            this.actor.grab_key_focus();
            settings.actor.destroy();
            this.header.actor.show();
            this.slider_item.actor.show();

            this.set_notif_msg(notif_msg);

            if (time) {
                this.clock = time;
                this.start();
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

    set_notif_msg: function (msg) {
        this.cache.notif_msg = msg;
        this._store_cache();
    },

    show_fullscreen: function () {
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
});
Signals.addSignalMethods(Timer.prototype);



// =====================================================================
// @@@ Settings window
//
// @ext       : obj (main extension object)
// @delegate  : obj (main section object)
// @show_secs : bool
// @notif_msg : string
//
// signals: 'ok', 'cancel'
// =====================================================================
const TimerSettings = new Lang.Class({
    Name: 'Timepp.TimerSettings',

    _init: function(ext, delegate, show_secs, notif_msg) {
        this.ext      = ext;
        this.delegate = delegate;

        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // time pickers
        //
        this.numpicker_box = new St.BoxLayout({ style_class: 'row numpicker-box' });
        this.content_box.add_actor(this.numpicker_box);

        this.hr_bin = new St.Bin({x_align: 1});
        this.numpicker_box.add(this.hr_bin, {expand: true});
        this.hr  = new NUM_PICKER.NumPicker(0, 23);
        this.hr_bin.add_actor(this.hr.actor);

        this.min_bin = new St.Bin({x_align: 1});
        this.numpicker_box.add(this.min_bin, {expand: true});
        this.min = new NUM_PICKER.NumPicker(0, 59);
        this.min_bin.add_actor(this.min.actor);

        if (show_secs) {
            this.sec_bin = new St.Bin({x_align: 1});
            this.numpicker_box.add(this.sec_bin, {expand: true});
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
        let btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add(btn_box, {expand: true});

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'button', x_expand: true });
        this.button_ok     = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true});
        btn_box.add(this.button_ok, {expand: true});


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
        let h   = this.hr.counter * 3600;
        let min = this.min.counter * 60;
        let sec = this.sec ? this.sec.counter : 0;

        return h + min + sec;
    },
});
Signals.addSignalMethods(TimerSettings.prototype);



// =====================================================================
// @@@ Timer fullscreen interface
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int
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


        this.title = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-phase-label' });
        this.middle_box.insert_child_at_index(this.title, 0);


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
            this.title.text = '';
        });
        this.slider.connect('value-changed', (slider, val) => {
            this.delegate.slider_changed(slider, val);
            this.actor.remove_style_class_name('timer-expired');
            this.title.text = '';
        });
        this.actor.connect('key-release-event', (_, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_space:
                    if (this.delegate.timer_state !== TimerState.OFF)
                        this.delegate.toggle_timer();
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_r:
                case Clutter.KEY_BackSpace:
                    this.delegate.start(this.delegate.cache.last_manually_set_time);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_1:
                    this.delegate.start(60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_2:
                    this.delegate.start(2 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_3:
                    this.delegate.start(3 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_4:
                    this.delegate.start(4 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_5:
                    this.delegate.start(5 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_6:
                    this.delegate.start(6 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_7:
                    this.delegate.start(7 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_8:
                    this.delegate.start(8 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_9:
                    this.delegate.start(9 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_0:
                    this.delegate.start(10 * 60);
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }
        });
    },

    close: function () {
        if (this.delegate.timer_state === TimerState.OFF) {
            this.actor.style_class = this.default_style_class;
            this.title.text = '';
            this.set_banner_text(
                this.delegate.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        }

        this.parent();
    },

    on_timer_started: function () {
        this.actor.style_class = this.default_style_class;
        this.title.text = '';
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
        if (this.delegate.cache.notif_msg) {
            this.title.text = TIMER_EXPIRED_MSG;
            this.set_banner_text(this.delegate.cache.notif_msg);
        }
        else {
            this.set_banner_text(TIMER_EXPIRED_MSG);
        }
        this.actor.style_class = this.default_style_class + ' timer-expired';
    },
});
Signals.addSignalMethods(TimerFullscreen.prototype);
