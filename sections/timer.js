const St          = imports.gi.St;
const Gio         = imports.gi.Gio
const Gtk         = imports.gi.Gtk;
const GLib        = imports.gi.GLib;
const Clutter     = imports.gi.Clutter;
const Main        = imports.ui.main;
const CheckBox    = imports.ui.checkBox;
const MessageTray = imports.ui.messageTray;
const Slider      = imports.ui.slider;
const ByteArray = imports.byteArray;
const Signals     = imports.signals;
const Mainloop    = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SOUND_PLAYER    = ME.imports.lib.sound_player;
const FULLSCREEN      = ME.imports.lib.fullscreen;
const SIG_MANAGER     = ME.imports.lib.signal_manager;
const KEY_MANAGER     = ME.imports.lib.keybinding_manager;
const PANEL_ITEM      = ME.imports.lib.panel_item;
const NUM_PICKER      = ME.imports.lib.num_picker;
const MULTIL_ENTRY    = ME.imports.lib.multiline_entry;
const TEXT_LINKS_MNGR = ME.imports.lib.text_links_manager;
const MISC_UTILS      = ME.imports.lib.misc_utils;
const FUZZ            = ME.imports.lib.fuzzy_search;
const REG             = ME.imports.lib.regex;


const IFACE = `${ME.path}/dbus/timer_iface.xml`;


const CACHE_FILE = '~/.cache/timepp_gnome_shell_extension/timepp_timer.json';


const TIMER_MAX_DURATION = 24 * 60 * 60 * 1000000; // microseconds
const TIMER_EXPIRED_MSG  = _('Timer Expired!');


const TimerState = {
    RUNNING : 'RUNNING',
    STOPPED : 'STOPPED',
    OFF     : 'OFF',
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
var SectionMain = class SectionMain extends ME.imports.sections.section_base.SectionBase {
    constructor (section_name, ext, settings) {
        super(section_name, ext, settings);

        this.actor.add_style_class_name('timer-section');

        this.separate_menu = this.settings.get_boolean('timer-separate-menu');


        this.timer_state     = TimerState.OFF;
        this.tic_mainloop_id = null;
        this.cache_file      = null;
        this.cache           = null;
        this.notif_source    = null;

        this.clock           = 0; // microseconds
        this.end_time        = 0; // for computing elapsed time (microseconds)

        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + ByteArray.toString(xml);
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
            this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/Timer');
        }


        this.linkm = new TEXT_LINKS_MNGR.TextLinksManager();
        this.sigm  = new SIG_MANAGER.SignalManager();
        this.keym  = new KEY_MANAGER.KeybindingManager(this.settings);
        this.sound_player = new SOUND_PLAYER.SoundPlayer();


        this.fullscreen = new TimerFullscreen(this.ext, this,
            this.settings.get_int('timer-fullscreen-monitor-pos'));
        this.fullscreen.set_banner_text(
            this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');


        try {
            this.cache_file = MISC_UTILS.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].timer;

            if (this.cache_file.query_exists(null)) {
                let [a, contents, b] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(ByteArray.toString(contents));
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                // @preset_object  : { time: number (seconds),
                //                     msg: string,
                //                     repeat_sound: bool, }
                //
                // @custom_presets : array of @preset_object
                // @default_preset : @preset_object
                this.cache = {
                    format_version         : cache_format_version,
                    default_preset         : {time: 60, msg: '', repeat_sound: false},
                    custom_presets         : [],
                };
            }
        } catch (e) {
            logError(e);
            return;
        }


        this.current_preset = this.cache.default_preset;


        //
        // keybindings
        //
        this.keym.add('timer-keybinding-open', () => {
            this.ext.open_menu(this.section_name);
        });
        this.keym.add('timer-keybinding-open-fullscreen', () => {
            this.show_fullscreen();
        });
        this.keym.add('timer-keybinding-open-to-search-presets', () => {
            this.ext.open_menu(this.section_name);
            this._show_presets();
        });


        //
        // panel item
        //
        this.panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-timer-symbolic');
        this.panel_item.actor.add_style_class_name('timer-panel-item');
        this.panel_item.set_label(this.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        this._toggle_panel_item_mode();


        //
        // header
        //
        this.header = new St.BoxLayout({ style_class: 'timepp-menu-item header' });
        this.actor.add_actor(this.header);

        this.header_label = new St.Label({ x_expand: true, text: _('Timer'), style_class: 'clock' });
        this.header.add_child(this.header_label);

        this.icon_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style_class: 'icon-box' });
        this.header.add(this.icon_box);

        this.start_pause_icon = new St.Icon({ visible: false, reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-pause-symbolic'), style_class: 'pause-icon' });
        this.icon_box.add_actor(this.start_pause_icon);

        this.fullscreen_icon = new St.Icon({ reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-fullscreen-symbolic'), style_class: 'fullscreen-icon' });
        this.icon_box.add_actor(this.fullscreen_icon);

        this.settings_icon = new St.Icon({ reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-settings-symbolic'), style_class: 'settings-icon' });
        this.icon_box.add(this.settings_icon);


        //
        // timer slider
        //
        {
            this.slider_item = new St.BoxLayout({ vertical: true, style_class: 'timepp-menu-item' });
            this.actor.add_child(this.slider_item);
            this.slider = new Slider.Slider(0);
            this.slider_item.add_actor(this.slider.actor);
        }


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
        this.sigm.connect(this.settings, 'changed::timer-show-seconds', () => this._update_time_display());
        this.sigm.connect(this.settings, 'changed::timer-panel-mode', () => this._toggle_panel_item_mode());
        this.sigm.connect(this.panel_item, 'middle-click', () => this.toggle_timer());
        this.sigm.connect_release(this.start_pause_icon, Clutter.BUTTON_PRIMARY, true, () => this.toggle_timer());
        this.sigm.connect_release(this.fullscreen_icon, Clutter.BUTTON_PRIMARY, true, () => this.show_fullscreen());
        this.sigm.connect_release(this.settings_icon, Clutter.BUTTON_PRIMARY, true, () => this._show_presets());
        this.sigm.connect(this.slider, 'notify::value', () => this.slider_changed(this.slider.value));
        this.sigm.connect(this.slider, 'drag-end', () => this.slider_released());
        this.sigm.connect(this.slider.actor, 'scroll-event', () => this.slider_released());
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

    toggle_timer () {
        if      (this.timer_state === TimerState.STOPPED) this.start();
        else if (this.timer_state === TimerState.RUNNING) this.stop();
    }

    // This func is used for DBus.
    // DBus has no optional arguments, so @time === 0 and @msg === "null" means
    // that those arguments are omitted, and in that case we don't update the
    // default preset.
    start_from_default_preset (time, msg) {
        this.current_preset = this.cache.default_preset;

        if (time > 0)       this.current_preset.time = time;
        if (msg !== "null") this.current_preset.msg  = msg;

        Mainloop.idle_add(() => this._store_cache());

        this.start(this.current_preset.time);
    }

    start_from_preset (preset, time = null) {
        this.current_preset = preset;

        if (time !== null) {
            preset.time = time;
            Mainloop.idle_add(() => this._store_cache());
        }

        this.start(preset.time);
    }

    // @time: int (seconds)
    start (time) {
        this.timer_state = TimerState.RUNNING;

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.sound_player.stop();
        if (this.notif_source) this.notif_source.destroyNonResidentNotifications();

        if (time) time *= 1000000;
        else      time  = this.clock;

        this.end_time = GLib.get_monotonic_time() + time;

        this.fullscreen.on_timer_started();
        this.start_pause_icon.show();
        this.start_pause_icon.gicon = MISC_UTILS.getIcon('timepp-pause-symbolic');
        this.start_pause_icon.style_class = 'pause-icon';
        this.panel_item.actor.add_style_class_name('on');

        if (this.settings.get_enum('timer-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon_text');

        this._tic();
    }

    stop () {
        this.timer_state = TimerState.STOPPED;

        this.clock = this.end_time - GLib.get_monotonic_time();

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.fullscreen.on_timer_stopped();
        this.start_pause_icon.gicon = MISC_UTILS.getIcon('timepp-start-symbolic');
        this.start_pause_icon.style_class = 'start-icon';
        this.panel_item.actor.remove_style_class_name('on');

        if (this.settings.get_enum('timer-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon');
    }

    reset () {
        this.timer_state = TimerState.OFF;

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        this.slider.value = 0;
        this.fullscreen.on_timer_off();
        this.header_label.text = _('Timer');
        this.start_pause_icon.hide();
        this.panel_item.actor.remove_style_class_name('on');

        if (this.settings.get_enum('timer-panel-mode') === PanelMode.DYNAMIC)
            this.panel_item.set_mode('icon');
    }

    _on_timer_expired () {
        this.reset();
        this._send_notif();
        this.dbus_impl.emit_signal('timer_expired', null);
    }

    _tic () {
        this.clock = this.end_time - GLib.get_monotonic_time();

        this._update_slider();
        this._update_time_display();

        if (this.clock <= 0) {
            this.clock = 0;
            this._on_timer_expired();
            return;
        }

        this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._tic();
        });
    }

    _update_time_display () {
        let time = Math.ceil(this.clock / 1000000);
        let txt;

        // If the seconds are not shown, we need to make the timer '1-indexed'
        // in respect to minutes. I.e., 00:00:34 becomes 00:01.
        if (this.settings.get_boolean('timer-show-seconds')) {
            txt = "%02d:%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );
        } else {
            if (time % 3600 !== 0) time += 60;

            txt = "%02d:%02d".format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60)
            );
        }

        this.header_label.text = txt;
        this.panel_item.set_label(txt);
        this.fullscreen.set_banner_text(txt);
    }

    // Update slider based on the clock.
    // This function is the inverse of the function that is used to calc the
    // clock based on the slider.
    _update_slider () {
        let x = this.clock / TIMER_MAX_DURATION;
        let y = (Math.log(x * (Math.pow(2, 10) - 1) +1)) / Math.log(2) / 10;

        this.slider.value = y;
        this.fullscreen.slider.value = y;
    }

    slider_released () {
        if (this.clock < 1000000) {
            this.reset();
        } else {
            this.start_from_preset(this.cache.default_preset, Math.round(this.clock / 1000000));
            this.start();
            this._store_cache();
        }
    }

    slider_changed (value) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

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

            this.clock = Math.floor(y * TIMER_MAX_DURATION / step) * step;
            this._update_time_display();
        }
        else { // slider has been dragged past the limit
            this.clock = TIMER_MAX_DURATION;
            this._update_time_display();
        }
    }

    _send_notif () {
        let notif_type = this.settings.get_enum('timer-notif-style');

        if (notif_type === NotifStyle.NONE) {
            // no visual notification
        } else if (notif_type === NotifStyle.FULLSCREEN || this.fullscreen.is_open) {
            this.fullscreen.open();
            this.fullscreen.on_timer_expired();
        } else {
            if (this.notif_source) {
                this.notif_source.destroyNonResidentNotifications();
            }

            this.notif_source = new MessageTray.Source();
            Main.messageTray.add(this.notif_source);
            this.notif_source.connect('destroy', () => this.sound_player.stop());

            let icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-timer-symbolic') });
            let params = {
                bannerMarkup : true,
                gicon        : icon.gicon,
            };

            let notif = new MessageTray.Notification(
                this.notif_source,
                TIMER_EXPIRED_MSG,
                this.current_preset.msg || '',
                params
            );

            notif.setUrgency(MessageTray.Urgency.CRITICAL);
            this.notif_source.notify(notif);
        }

        if (this.settings.get_boolean('timer-play-sound')) {
            this.sound_player.set_sound_uri(this.settings.get_string('timer-sound-file-path'));
            this.sound_player.play(this.current_preset.repeat_sound);
        }
    }

    _show_presets () {
        let presets_view = new TimerPresetsView(this.ext, this);

        this.timepicker_container.add_actor(presets_view.actor);

        Mainloop.timeout_add(0, () => presets_view.entry.entry.grab_key_focus());
        this.header.hide();
        this.slider_item.hide();

        presets_view.connect('start-timer', (_, preset) => {
            this.actor.grab_key_focus();
            presets_view.actor.destroy();
            this.header.show();
            this.slider_item.show();
            this.start_from_preset(preset);
            this.ext.menu.close(false);
        });

        presets_view.connect('add-preset', (_, preset) => {
            this.cache.custom_presets.push(preset);
            this._store_cache();
        });

        presets_view.connect('edited-preset', (_, preset) => {
            this._store_cache();
        });

        presets_view.connect('delete-preset', (_, preset) => {
            if (this.current_preset === preset) {
                this.current_preset = this.cache.default_preset;
            }

            for (let i = 0; i < this.cache.custom_presets.length; i++) {
                if (this.cache.custom_presets[i] === preset)
                    this.cache.custom_presets.splice(i, 1);
            }

            this._store_cache();
        });

        presets_view.connect('ok', () => {
            this.actor.grab_key_focus();
            presets_view.actor.destroy();
            this.header.show();
            this.slider_item.show();
        });
    }

    show_fullscreen () {
        this.ext.menu.close();

        if (! this.fullscreen) {
            this.fullscreen = new TimerFullscreen(
                this.ext, this, this.settings.get_int('timer-fullscreen-monitor-pos'));
        }

        this.fullscreen.open();
    }

    _toggle_panel_item_mode () {
        switch (this.settings.get_enum('timer-panel-mode')) {
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
            if (this.timer_state === TimerState.RUNNING) this.panel_item.set_mode('icon_text');
            else                                         this.panel_item.set_mode('icon');
        }
    }

    highlight_tokens (text) {
        text = GLib.markup_escape_text(text, -1);
        text = MISC_UTILS.split_on_whitespace(text);

        let inside_backticks = false;

        for (let i = 0; i < text.length; i++) {
            let token = text[i];

            if (token.startsWith('`') || token.endsWith('`')) inside_backticks = !inside_backticks;
            if (inside_backticks) continue;

            if (REG.URL.test(token) || REG.FILE_PATH.test(token)) {
                text[i] =
                    '`<span foreground="' + this.ext.custom_css['-timepp-link-color'][0] +
                    '"><u><b>' + token + '</b></u></span>`';
            }
        }

        text = text.join('');
        return MISC_UTILS.markdown_to_pango(text, this.ext.markdown_map);
    }
}
Signals.addSignalMethods(SectionMain.prototype);



// =====================================================================
// @@@ TimerPresetsView
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//    - 'ok'
//    - 'edited-preset'
//    - 'add-preset'    (returns a preset obj)
//    - 'start-timer'   (returns a preset obj)
//    - 'delete-preset' (returns a preset obj)
// =====================================================================
var TimerPresetsView = class TimerPresetsView {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.css = this.ext.custom_css;


        // objects returned by _new_preset_item() func
        this.preset_items = new Set();


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // search presets entry
        //
        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Search...'), true);
        this.content_box.add(this.entry.actor);
        this.entry.actor.add_style_class_name('row');
        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;


        //
        // preset items container
        //
        this.preset_items_scrollview = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.preset_items_scrollview);
        this.preset_items_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.preset_items_scrollview.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.preset_items_scrollbox = new St.BoxLayout({ vertical: true, style_class: 'row' });
        this.preset_items_scrollview.add_actor(this.preset_items_scrollbox);

        {
            let it = this._new_preset_item(this.delegate.cache.default_preset);
            this.preset_items_scrollbox.add_child(it.actor);

            it.actor.add_style_class_name('timer-preset-item-default');
            it.is_default = true;

            let label = new St.Label({ x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'timer-preset-item-default-indicator-label' });
            it.header.insert_child_at_index(label, 1);

            label.clutter_text.set_markup(`   <b>${_('Default preset')}</b>`);
            it.header.get_first_child().x_expand = false;
        }

        for (let preset of this.delegate.cache.custom_presets) {
            this.preset_items_scrollbox.add_child(this._new_preset_item(preset).actor);
        }


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(btn_box);
        this.button_add_preset = new St.Button({ can_focus: true, label: _('Add Preset'), style_class: 'button', x_expand: true });
        this.button_ok         = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'button', x_expand: true });
        btn_box.add(this.button_add_preset, {expand: true});
        btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.preset_items_scrollbox.connect('allocation-changed', () => {
            this.preset_items_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar()) this.preset_items_scrollview.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.entry.entry.connect('allocation-changed', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar()) this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.entry.entry.clutter_text.connect('text-changed', () => this._search_presets());
        this.button_add_preset.connect('clicked', () => this._show_preset_editor());
        this.button_ok.connect('clicked', () => this.emit('ok'));
    }

    _search_presets () {
        this.preset_items_scrollbox.remove_all_children();
        let needle = this.entry.entry.get_text().toLowerCase();

        if (!needle) {
            for (let it of this.preset_items)
                this.preset_items_scrollbox.add_child(it.actor);
        } else {
            let reduced_results = [];

            for (let it of this.preset_items) {
                let score = FUZZ.fuzzy_search_v1(needle, it.msg.text.toLowerCase());
                if (score) reduced_results.push([score, it]);
            }

            reduced_results.sort((a, b) => a[0] < b[0]);

            for (let it of reduced_results)
                this.preset_items_scrollbox.add_child(it[1].actor);
        }
    }

    _show_preset_editor (item) {
        let preset       = item ? item.preset : null;
        let is_deletable = Boolean(preset) && !item.is_default;

        let editor = new TimerPresetEditor(this.ext, this.delegate, preset, is_deletable);

        this.actor.add_child(editor.actor);
        editor.entry.entry.grab_key_focus();
        this.content_box.hide();

        editor.connect('ok', (_, info) => {
            this.content_box.show();
            let it;

            if (item) {
                it                     = item;
                it.preset.msg          = info.msg;
                it.preset.time         = info.time;
                it.preset.repeat_sound = info.repeat_sound;

                if (info.msg) {
                    it.msg.clutter_text.set_markup(this.delegate.highlight_tokens(info.msg));
                    it.msg.show();
                } else {
                    it.msg.hide();
                }

                let time_label = "%02d:%02d:%02d".format(
                    Math.floor(info.time / 3600),
                    Math.floor(info.time % 3600 / 60),
                    info.time % 60
                );
                it.time_label.clutter_text.set_markup(`<b>${time_label}</b>`);
                this.emit('edited-preset');
            } else {
                it = this._new_preset_item(info);
                this.preset_items_scrollbox.add_child(it.actor);
                this.emit('add-preset', info);
            }

            it.icon_box.show();
            it.icon_box.get_first_child().grab_key_focus();
            Mainloop.idle_add(() => {
                MISC_UTILS.scroll_to_item(this.preset_items_scrollview,
                                          this.preset_items_scrollbox,
                                          it.actor);
            });

            this.entry.entry.grab_key_focus();
            editor.actor.destroy();
        });

        editor.connect('delete', () => {
            this.preset_items.delete(item);
            item.actor.destroy();
            this.content_box.show();
            this.entry.entry.grab_key_focus();
            editor.actor.destroy();

            this.emit('delete-preset', preset);
        });

        editor.connect('cancel', () => {
            this.content_box.show();
            this.entry.entry.grab_key_focus();
            editor.actor.destroy();
        });
    }

    _new_preset_item (preset) {
        let item = {};

        item.preset = preset;

        this.preset_items.add(item);

        item.actor = new St.BoxLayout({ can_focus: true, reactive: true, vertical: true, style_class: 'timer-preset-item' });

        item.header = new St.BoxLayout();
        item.actor.add_child(item.header);

        item.msg = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        item.actor.add_child(item.msg);

        this.delegate.linkm.add_label_actor(item.msg, new Map([
            [REG.URL       , MISC_UTILS.open_web_uri],
            [REG.FILE_PATH , MISC_UTILS.open_file_path],
        ]));

        if (preset.msg) {
            item.msg.clutter_text.set_markup(this.delegate.highlight_tokens(preset.msg));
            item.msg.show();
        } else {
            item.msg.hide();
        }

        item.time_label = new St.Label({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        item.header.add_child(item.time_label);

        {
            let time_label = "%02d:%02d:%02d".format(
                Math.floor(preset.time / 3600),
                Math.floor(preset.time % 3600 / 60),
                preset.time % 60
            );
            item.time_label.clutter_text.set_markup(`<b>${time_label}</b>`);
        }


        // icons
        item.icon_box = new St.BoxLayout({ visible: false, style_class: 'icon-box' });
        item.header.add_child(item.icon_box);

        let start_icon = new St.Icon({ track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-start-symbolic') });
        item.icon_box.add_child(start_icon);

        let edit_icon = new St.Icon({ track_hover: true, can_focus: true, reactive: true, gicon : MISC_UTILS.getIcon('timepp-edit-symbolic') });
        item.icon_box.add_child(edit_icon);


        // listen
        this.delegate.sigm.connect_release(start_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this.emit('start-timer', preset);
        });
        this.delegate.sigm.connect_release(edit_icon, Clutter.BUTTON_PRIMARY, true, () => {
            Main.panel.menuManager.ignoreRelease();
            this._show_preset_editor(item);
        });
        item.actor.connect('key-focus-in', () => { item.actor.can_focus = false; });
        item.actor.connect('event', (_, event) => this._on_preset_item_event(item, event));


        return item;
    }

    _on_preset_item_event (item, event) {
        switch (event.type()) {
            case Clutter.EventType.ENTER: {
                let related = event.get_related();
                if (related && !item.actor.contains(related)) item.icon_box.show();
                break;
            }

            case Clutter.EventType.LEAVE: {
                let related = event.get_related();

                if (!item.header.contains(global.stage.get_key_focus()) &&
                    related &&
                    !item.actor.contains(related)) {

                    item.icon_box.hide();
                    item.actor.can_focus = true;
                }
                break;
            }

            case Clutter.EventType.KEY_RELEASE: {
                item.icon_box.show();
                if (!item.header.contains(global.stage.get_key_focus())) {
                    item.icon_box.get_first_child().grab_key_focus();
                }
                MISC_UTILS.scroll_to_item(this.preset_items_scrollview,
                                          this.preset_items_scrollbox,
                                          item.actor);
                break;
            }

            case Clutter.EventType.KEY_PRESS: {
                Mainloop.idle_add(() => {
                    if (item.icon_box && !item.header.contains(global.stage.get_key_focus())) {
                        item.actor.can_focus = true;
                        item.icon_box.hide();
                    }
                });
                break;
            }
        }
    }
}
Signals.addSignalMethods(TimerPresetsView.prototype);



// =====================================================================
// @@@ TimerPresetEditor
//
// @ext          : obj (main extension object)
// @delegate     : obj (main section object)
// @preset       : obj
//
// @signals: 'ok', 'cancel', 'delete'
// =====================================================================
var TimerPresetEditor = class TimerPresetEditor {
    constructor (ext, delegate, preset, is_deletable) {
        this.ext      = ext;
        this.delegate = delegate;
        this.preset   = preset;


        //
        // container
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'view-box-content' });


        //
        // time pickers
        //
        {
            let box = new St.BoxLayout({ style_class: 'row numpicker-box' });
            this.actor.add_actor(box);

            let label = new St.Label({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            box.add_child(label);

            this.hr = new NUM_PICKER.NumPicker(0, 23);
            box.add_child(this.hr.actor);

            this.min = new NUM_PICKER.NumPicker(0, 59);
            box.add_child(this.min.actor);

            if (this.delegate.settings.get_boolean('timer-show-seconds')) {
                label.text = `${_('(h:min:sec)')} `;
                this.sec = new NUM_PICKER.NumPicker(0, 59);
                box.add_child(this.sec.actor);
            } else {
                label.text = `${_('(h:min)')} `;
            }
        }

        this._set_time();


        //
        // entry
        //
        this.entry_container = new St.BoxLayout({ x_expand: true, style_class: 'row entry-container' });
        this.actor.add_actor(this.entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Timer message...'), true);
        this.entry_container.add(this.entry.actor, {expand: true});

        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;

        if (preset) this.entry.set_text(preset.msg);


        //
        // repeat sound checkbox
        //
        this.checkbox_item = new St.BoxLayout({ reactive: true, x_expand: true, style_class: 'row' });
        this.actor.add_actor(this.checkbox_item);

        this.checkbox_item.add_child(
            new St.Label({ text: _('Repeat notification sound?'), x_expand: true, y_align: Clutter.ActorAlign.CENTER }));

        this.sound_checkbox = new CheckBox.CheckBox();
        this.checkbox_item.add_child(this.sound_checkbox.actor);
        this.sound_checkbox.actor.checked = preset ? preset.repeat_sound : false;


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.actor.add(btn_box, {expand: true});

        if (is_deletable) {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            btn_box.add(this.button_delete, {expand: true});
            this.button_delete.connect('clicked', () => this.emit('delete'));
        }

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        this.button_ok     = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true});
        btn_box.add(this.button_ok, {expand: true});



        //
        // listen
        //
        this.entry.entry.connect('allocation-changed', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar()) this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.button_ok.connect('clicked', () => {
            this.emit('ok', {
                time         : this._get_time(),
                msg          : this.entry.entry.get_text(),
                repeat_sound : this.sound_checkbox.actor.checked,
            });
        });
        this.button_cancel.connect('clicked', () => this.emit('cancel'));
        this.checkbox_item.connect('button-press-event', () => {
            this.sound_checkbox.actor.checked = !this.sound_checkbox.actor.checked;
        });
    }

    _set_time () {
        if (! this.preset) return;

        this.hr.set_counter(Math.floor(this.preset.time / 3600));
        this.min.set_counter(Math.floor(this.preset.time % 3600 / 60));
        if (this.sec) this.sec.set_counter(this.preset.time % 60);
    }

    _get_time () {
        let h   = this.hr.counter * 3600;
        let min = this.min.counter * 60;
        let sec = this.sec ? this.sec.counter : 0;

        return h + min + sec;
    }
}
Signals.addSignalMethods(TimerPresetEditor.prototype);



// =====================================================================
// @@@ Timer fullscreen interface
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int
//
// @signals: 'monitor-changed'
// =====================================================================
var TimerFullscreen = class TimerFullscreen extends FULLSCREEN.Fullscreen {
    constructor (ext, delegate, monitor) {
        super(monitor);
        this.default_style_class = this.actor.style_class;

        this.ext      = ext;
        this.delegate = delegate;

        this.delegate.linkm.add_label_actor(this.banner, new Map([
            [REG.URL       , MISC_UTILS.open_web_uri],
            [REG.FILE_PATH , MISC_UTILS.open_file_path],
        ]));


        //
        // actors
        //
        this.title = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, style_class: 'pomo-phase-label' });
        this.middle_box.insert_child_at_index(this.title, 0);

        this.slider = new Slider.Slider(0);
        this.bottom_box.add_child(this.slider.actor);
        this.slider.actor.can_focus = true;

        this.start_pause_btn = new St.Button();
        this.top_box.insert_child_at_index(this.start_pause_btn, 0);
        this.start_pause_icon = new St.Icon({ visible: false, reactive: true, can_focus: true, track_hover: true, gicon : MISC_UTILS.getIcon('timepp-pause-symbolic'), style_class: 'pause-icon' });
        this.start_pause_btn.add_actor(this.start_pause_icon);


        //
        // listen
        //
        this.start_pause_btn.connect('clicked', () => {
            this.delegate.toggle_timer();
        });
        this.slider.connect('drag-end', () => {
            this.delegate.slider_released();
        });
        this.slider.actor.connect('scroll-event', () => {
            this.delegate.slider_released();
            this.title.text = '';
        });
        this.slider.connect('notify::value', () => {
            this.delegate.slider_changed(this.slider.value);
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
                    this.delegate.start(this.delegate.current_preset.time);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_1:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 60);
                    this.delegate.start(60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_2:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 2 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_3:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 3 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_4:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 4 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_5:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 5 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_6:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 6 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_7:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 7 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_8:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 8 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_9:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 9 * 60);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_0:
                    this.delegate.start_from_preset(this.delegate.cache.default_preset, 10 * 60);
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }
        });
    }

    close () {
        this.delegate.sound_player.stop();

        if (this.delegate.timer_state === TimerState.OFF) {
            this.actor.style_class = this.default_style_class;
            this.title.text = '';
            this.set_banner_text(
                this.delegate.settings.get_boolean('timer-show-seconds') ? '00:00:00' : '00:00');
        }

        super.close();
    }

    on_timer_started () {
        this.actor.style_class = this.default_style_class;
        this.title.text = '';
        this.start_pause_icon.gicon = MISC_UTILS.getIcon('timepp-pause-symbolic');
        this.start_pause_icon.style_class = 'pause-icon';
        this.start_pause_icon.show();
    }

    on_timer_stopped () {
        this.actor.style_class = this.default_style_class + ' timer-stopped';
        this.start_pause_icon.gicon = MISC_UTILS.getIcon('timepp-start-symbolic');
        this.start_pause_icon.style_class = 'start-icon';
    }

    on_timer_off () {
        this.start_pause_icon.hide();
        this.slider.value = 0;
    }

    on_timer_expired () {
        if (this.delegate.current_preset.msg) {
            this.title.text = TIMER_EXPIRED_MSG;
            this.set_banner_text(this.delegate.highlight_tokens(this.delegate.current_preset.msg));
        } else {
            this.set_banner_text(TIMER_EXPIRED_MSG);
        }

        this.actor.style_class = this.default_style_class + ' timer-expired';
    }
}
Signals.addSignalMethods(TimerFullscreen.prototype);
