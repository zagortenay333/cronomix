const St             = imports.gi.St;
const Gio            = imports.gi.Gio
const Gtk            = imports.gi.Gtk;
const GLib           = imports.gi.GLib;
const Meta           = imports.gi.Meta;
const Shell          = imports.gi.Shell;
const Clutter        = imports.gi.Clutter;
const Main           = imports.ui.main;
const PopupMenu      = imports.ui.popupMenu;
const Lang           = imports.lang;
const Signals        = imports.signals;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const SIG_MANAGER   = ME.imports.lib.signal_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const ICON_FROM_URI = ME.imports.lib.icon_from_uri;


const CACHE_FILE     = GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension/timepp_stopwatch.json';
const STOPWATCH_ICON = '/img/stopwatch-symbolic.svg';


const StopwatchState = {
    RUNNING : 'RUNNING',
    PAUSED  : 'PAUSED',
    RESET   : 'RESET',
};


const ClockFormat = {
    H_M      : 0,
    H_M_S    : 1,
    H_M_S_MS : 2,
};


// =====================================================================
// @@@ Main
//
// @ext      : obj    (main extension object)
// @ext_dir  : string (extenstion dir path)
// @settings : obj    (extension settings)
// =====================================================================
const Stopwatch = new Lang.Class({
    Name: 'Timepp.Stopwatch',

    _init: function (ext, ext_dir, settings) {
        this.ext      = ext;
        this.ext_dir  = ext_dir;
        this.settings = settings;

        this.sigm = new SIG_MANAGER.SignalManager();

        this.clock_format    = this.settings.get_enum('stopwatch-clock-format');
        this.start_time      = 0;
        this.keybindings     = [];
        this.lap_count       = 0;
        this.section_enabled = this.settings.get_boolean('timer-enabled');
        this.separate_menu   = this.settings.get_boolean('timer-separate-menu');
        this.cache_file      = null;
        this.cache           = null;
        this.time_backup_mainloop_id = null;
        this.tic_mainloop_id = null;


        //
        // panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        switch (this.clock_format) {
            case ClockFormat.H_M:
                this.panel_item.set_label('00:00');
                break;
            case ClockFormat.H_M_S:
                this.panel_item.set_label('00:00:00');
                break;
            case ClockFormat.H_M_S_MS:
                this.panel_item.set_label('00:00:00:0000');
                break;
        }

        this.panel_item.actor.add_style_class_name('stopwatch-panel-item');
        this._update_panel_icon_name();
        this._toggle_panel_mode();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        //
        // section
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section stopwatch-section' });


        //
        // timer label
        //
        this.time_display = new PopupMenu.PopupMenuItem(_('Stopwatch'), { hover: false, activate: false, style_class: 'header' });
        this.actor.add(this.time_display.actor, {expand: true});
        this.time_display.actor.can_focus = false;


        //
        // buttons
        //
        let btn_box_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add_actor(btn_box_wrapper.actor);
        btn_box_wrapper.label.hide();
        btn_box_wrapper.actor.can_focus = false;

        this.stopwatch_button_box = new St.BoxLayout({ style_class: 'btn-box' });
        btn_box_wrapper.actor.add(this.stopwatch_button_box, {expand: true});


        this.button_reset = new St.Button({ can_focus: true, label: _('Reset'), style_class: 'btn-reset button', x_expand: true, visible: false });
        this.button_lap   = new St.Button({ can_focus: true, label: _('Lap'),   style_class: 'btn-lap button',   x_expand: true, visible: false });
        this.button_start = new St.Button({ can_focus: true, label: _('Start'), style_class: 'btn-start button', x_expand: true });
        this.button_pause = new St.Button({ can_focus: true, label: _('Pause'), style_class: 'btn-stop button',  x_expand: true, visible: false });
        this.stopwatch_button_box.add(this.button_reset, {expand: true});
        this.stopwatch_button_box.add(this.button_lap, {expand: true});
        this.stopwatch_button_box.add(this.button_start, {expand: true});
        this.stopwatch_button_box.add(this.button_pause, {expand: true});


        //
        // laps box
        //
        this.laps_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add(this.laps_wrapper.actor, {expand: true});
        this.laps_wrapper.actor.can_focus = false;
        this.laps_wrapper.label.hide();
        this.laps_wrapper.actor.hide();

        this.laps_scroll = new St.ScrollView({ style_class: 'laps-scrollview vfade', x_fill: true, y_fill: false, y_align: St.Align.START});
        this.laps_wrapper.actor.add(this.laps_scroll, {expand: true});

        this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.laps_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.laps_section = new St.BoxLayout({ vertical: true });
        this.laps_scroll.add_actor(this.laps_section);


        //
        // listen
        //
        this.settings.connect('changed::stopwatch-enabled', () => {
            this.section_enabled = this.settings.get_boolean('stopwatch-enabled');
            this._toggle_section();
        }); // don't put this signal into the signal manager

        this.sigm.connect(this.settings, 'changed::stopwatch-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('stopwatch-separate-menu');
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-clock-format', () => {
            this.clock_format = this.settings.get_enum('stopwatch-clock-format');
            this.panel_item.set_label(this._time_format_str());
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-panel-mode', () => {
            this._toggle_panel_mode();
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-keybinding-open', () => {
            this._toggle_keybindings();
        });
        this.sigm.connect(this.panel_item, 'click', Lang.bind(this, function () {
            this.emit('toggle-menu');
        }));
        this.sigm.connect(this.panel_item, 'middle-click', Lang.bind(this, this._stopwatch_toggle));
        this.sigm.connect(this.button_start, 'clicked', Lang.bind(this, this._start));
        this.sigm.connect(this.button_reset, 'clicked', Lang.bind(this, this._reset));
        this.sigm.connect(this.button_pause, 'clicked', Lang.bind(this, this._pause));
        this.sigm.connect(this.button_lap, 'clicked', Lang.bind(this, this._lap));
        this.sigm.connect(this.laps_section, 'queue-redraw', () => {
            this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar())
                this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });


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
                    state : StopwatchState.RESET,
                    time  : 0, // in microseconds
                    laps  : [],
                };
            }
        } catch (e) { logError(e); }


        this._toggle_keybindings();


        if (this.cache.state === StopwatchState.RESET) return;


        for (var i = 0; i < this.cache.laps.length; i++)
            this._lap(this.cache.laps[i]);

        this._update_time_display();

        if (this.cache.state === StopwatchState.RUNNING)
            this._start();
        else
            this._pause();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    _start: function (actor, event) {
        this.start_time = GLib.get_monotonic_time() - this.cache.time;
        this.button_pause.grab_key_focus();
        this.cache.state = StopwatchState.RUNNING;
        this._store_cache();
        this._toggle_buttons();
        this._panel_item_UI_update();
        if (! this.tic_mainloop_id) this._tic();
        if (! this.time_backup_mainloop_id) this._periodic_time_backup();
    },

    _pause: function (actor, event) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        this.button_start.grab_key_focus();
        this.cache.state = StopwatchState.PAUSED;
        this._store_cache();
        this._panel_item_UI_update();
        this._toggle_buttons();
    },

    _reset: function (actor, event) {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        this.button_start.grab_key_focus();
        this.cache.state = StopwatchState.RESET;
        this.cache.laps = [];
        this.cache.time = 0;
        this._store_cache();
        this.lap_count = 0;
        this._update_time_display();
        this._toggle_buttons();
        this._panel_item_UI_update();
        this._destroy_laps();
        this.time_display.label.text = _('Stopwatch');
    },

    _stopwatch_toggle: function () {
        if (this.cache.state === StopwatchState.RUNNING)
            this._pause();
        else
            this._start();
    },

    _tic: function () {
        this.cache.time = GLib.get_monotonic_time() - this.start_time;
        this._update_time_display();

        if (this.clock_format === ClockFormat.H_M_S_MS) {
            this.tic_mainloop_id = Mainloop.timeout_add(1, () => {
                this._tic();
            });
        }
        else {
            this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
                this._tic();
            });
        }
    },

    _update_time_display: function () {
        this.time_display.label.text = this._time_format_str();
        this.panel_item.set_label(this.time_display.label.text);
    },

    _time_format_str: function () {
        let t  = Math.floor(this.cache.time / 1000);
        let ms = t % 1000;
        t      = Math.floor(t / 1000);
        let h  = Math.floor(t / 3600);
        t      = t % 3600;
        let m  = Math.floor(t / 60);
        let s  = t % 60;

        switch (this.clock_format) {
            case ClockFormat.H_M:
                return "%02d:%02d".format(h, m);
            case ClockFormat.H_M_S:
                return "%02d:%02d:%02d".format(h, m, s);
            case ClockFormat.H_M_S_MS:
                return "%02d:%02d:%02d:%04d".format(h, m, s, ms);
        }
    },

    _panel_item_UI_update: function () {
        if (this.cache.state === StopwatchState.RUNNING)
            this.panel_item.actor.add_style_class_name('on');
        else
            this.panel_item.actor.remove_style_class_name('on');
    },

    _lap: function (lap_time) {
        this.laps_wrapper.actor.show();

        this.lap_count++;

        let lap = new St.BoxLayout({style_class: 'laps-item'});
        this.laps_section.add_actor(lap);

        let lap_count = new St.Label({text: this.lap_count + ': ', style_class: 'laps-item-counter'});
        lap.add_actor(lap_count);

        if (typeof(lap_time) !== 'string') {
            let str  = this._time_format_str();
            lap_time = new St.Label({text: str, style_class: 'laps-item-time'});
            this.cache.laps.push(str);
            this._store_cache();
        }
        else {
            lap_time = new St.Label({text: '' + lap_time, style_class: 'laps-item-time'});
        }

        lap.add_actor(lap_time);
    },

    _destroy_laps: function () {
        this.laps_wrapper.actor.hide();
        this.laps_section.destroy_all_children();
    },

    _toggle_buttons: function () {
        switch (this.cache.state) {
            case StopwatchState.RESET:
                this.button_reset.hide();
                this.button_lap.hide();
                this.button_start.show();
                this.button_pause.hide();
                this.button_start.add_style_pseudo_class('first-child');
                this.button_start.add_style_pseudo_class('last-child');
                break;

            case StopwatchState.RUNNING:
                this.button_reset.show();
                this.button_lap.show();
                this.button_start.hide();
                this.button_pause.show();
                break;

            case StopwatchState.PAUSED:
                this.button_reset.show();
                this.button_lap.hide();
                this.button_start.show();
                this.button_pause.hide();
                this.button_start.remove_style_pseudo_class('first-child');
                this.button_start.add_style_pseudo_class('last-child');
                break;
        }
    },

    _periodic_time_backup: function () {
        this._store_cache();

        this.time_backup_mainloop_id =
            Mainloop.timeout_add_seconds(60, () => {
                this._periodic_time_backup();
            });
    },

    _update_panel_icon_name: function() {
        ICON_FROM_URI.icon_from_uri(this.panel_item.icon, STOPWATCH_ICON, this.ext_dir);
    },

    _toggle_panel_mode: function () {
        if (this.settings.get_enum('stopwatch-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('stopwatch-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    },

    _toggle_keybindings: function (disable_all) {
        if (!disable_all &&
            this.settings.get_strv('stopwatch-keybinding-open')[0] !== '') {

            this.keybindings.push('stopwatch-keybinding-open');

            Main.wm.addKeybinding(
                'stopwatch-keybinding-open',
                this.settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => { this.ext.open_menu(this); });
        }
        else {
            let i = this.keybindings.indexOf('stopwatch-keybinding-open');
            if (i !== -1) {
                Main.wm.removeKeybinding('stopwatch-keybinding-open');
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
        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        if (this.cache.state === StopwatchState.RUNNING) this._pause();
        this._store_cache();
        this.sigm.disconnect_all();
        this._toggle_keybindings(true);
    },
});
Signals.addSignalMethods(Stopwatch.prototype);
