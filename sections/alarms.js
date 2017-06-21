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
const Lang           = imports.lang;
const Signals        = imports.signals;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const SIG_MANAGER    = ME.imports.lib.signal_manager;
const PANEL_ITEM     = ME.imports.lib.panel_item;
const ICON_FROM_URI  = ME.imports.lib.icon_from_uri;
const MULTIL_ENTRY   = ME.imports.lib.multiline_entry;
const NUM_PICKER     = ME.imports.lib.num_picker;
const DAY_CHOOSER    = ME.imports.lib.day_chooser;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const CACHE_FILE = GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension/timepp_alarms.json';
const ALARM_ICON = '/img/alarms-symbolic.svg';
const EDIT_ICON  = '/img/edit-symbolic.svg';



/*
 * time_str : string (time in hh:mm 24h format. E.g., '13:44')
 * alarm    : object { time_str : time_str,
 *                     msg      : string,
 *                     days     : array of ints (days of the week, sunday is 0),
 *                     toggle   : bool,
 *                     ID       : int/null (mainloop ID), }
 */


// =====================================================================
// @@@ Main
// =====================================================================
const Alarms = new Lang.Class({
    Name: 'Timepp.Alarms',

    _init: function (ext, ext_dir, settings) {
        this.ext      = ext;
        this.ext_dir  = ext_dir;
        this.settings = settings;


        this.sigm = new SIG_MANAGER.SignalManager();


        this.keybindings     = [];
        this.section_enabled = this.settings.get_boolean('alarms-enabled');
        this.separate_menu   = this.settings.get_boolean('alarms-separate-menu');
        this.cache_file      = null;
        this.cache           = null;


        //
        // add panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        this.panel_item.actor.add_style_class_name('alarm-panel-item');
        this.panel_item.set_mode('icon');
        this._update_panel_icon_name();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        //
        // alarms pane
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section alarm-section' });


        //
        // add new alarm item
        //
        this.add_alarm_item = new PopupMenu.PopupMenuItem(_('Add New Alarm...'), {style_class: 'header'});
        this.actor.add(this.add_alarm_item.actor, {expand: true});

        let header_icon = new St.Icon({ icon_name: 'list-add-symbolic' });
        this.add_alarm_item.actor.insert_child_below(header_icon, this.add_alarm_item.label);


        //
        // alarm items box
        //
        this.alarms_scroll_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add(this.alarms_scroll_wrapper.actor, {expand: true});
        this.alarms_scroll_wrapper.actor.hide();
        this.alarms_scroll_wrapper.label.hide();
        this.alarms_scroll_wrapper.actor.can_focus = false;

        this.alarms_scroll = new St.ScrollView({ style_class: 'alarms-container vfade', y_align: St.Align.START});
        this.alarms_scroll_wrapper.actor.add(this.alarms_scroll, {expand: true});

        this.alarms_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.alarms_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.alarms_scroll_content = new St.BoxLayout({ vertical: true, style_class: 'alarms-content-box' });
        this.alarms_scroll.add_actor(this.alarms_scroll_content);


        //
        // listen
        //
        this.settings.connect('changed::alarms-enabled', () => {
            this.section_enabled = this.settings.get_boolean('alarms-enabled');
            this._toggle_section();
        }); // don't put this signal into the signal manager

        this.sigm.connect(this.settings, 'changed::alarms-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('alarms-separate-menu');
        });
        this.sigm.connect(this.settings, 'changed::alarms-keybinding-open', () => {
            this._toggle_keybindings();
        });
        this.sigm.connect(this.panel_item, 'click', () => {
            this.emit('toggle-menu');
        });
        this.sigm.connect(this.add_alarm_item, 'activate', () => {
            this.alarm_editor();
        });
        this.sigm.connect(this.alarms_scroll_content, 'queue-redraw', () => {
            this.alarms_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (ext.needs_scrollbar())
                this.alarms_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });


        if (this.section_enabled) this._init__finish();
        else                      this.sigm.disconnect_all();
    },

    _init__finish: function () {
        try {
            if (! this.cache_file) {
                this.cache_file = Gio.file_new_for_path(CACHE_FILE);

                if ( this.cache_file.query_exists(null) ) {
                    let [a, contents, b] = this.cache_file.load_contents(null);
                    this.cache = JSON.parse(contents);
                }
                else {
                    this.cache = {
                        alarms: [],
                    };
                }
            }
        } catch (e) { logError(e); }

        for (var i = 0, len = this.cache.alarms.length; i < len; i++)
            this._add_alarm(i);

        this._toggle_keybindings();
        this._update_panel_item_UI();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    // @alarm_item: obj
    // If @alarm_item is not provided, then we are adding a new alarm.
    alarm_editor: function (alarm_item) {
        let alarm_obj = alarm_item ? alarm_item.alarm : null;

        let editor = new AlarmEditor(this.ext, alarm_obj);

        this.actor.insert_child_at_index(editor.actor, 0);
        editor.button_cancel.grab_key_focus();
        this.add_alarm_item.actor.hide();
        this.alarms_scroll_wrapper.actor.hide();

        if (! alarm_item) {
            editor.connect('add-alarm', (_, alarm) => {
                this.add_alarm_item.actor.show();
                this.alarms_scroll_wrapper.actor.show();
                this.add_alarm_item.actor.grab_key_focus();
                this._add_alarm(alarm);
                editor.actor.destroy();
            });
        }
        else {
            editor.connect('edited-alarm', (_, alarm) => {
                alarm_item.toggle.setToggleState(alarm.toggle);
                alarm_item.time.set_text(alarm.time_str);
                alarm_item.msg.clutter_text.set_markup(alarm.msg);

                if (alarm.msg) alarm_item.msg.show();
                else alarm_item.msg.hide();

                alarm_item.alarm_item_content.show();

                this.add_alarm_item.actor.show();
                this.alarms_scroll_wrapper.actor.show();
                this.add_alarm_item.actor.grab_key_focus();
                editor.actor.destroy();

                if (alarm.ID) Mainloop.source_remove(alarm.ID);
                this._schedule_alarm(alarm);
                this._store_cache();
            });

            editor.connect('delete-alarm', () => {
                this.add_alarm_item.actor.show();
                this.alarms_scroll_wrapper.actor.show();
                this.add_alarm_item.actor.grab_key_focus();
                editor.actor.destroy();
                alarm_item.actor.destroy();
                this._delete_alarm(alarm_item.alarm);
            });
        }

        editor.connect('cancel', () => {
            this.add_alarm_item.actor.show();
            if (this.alarms_scroll_content.get_n_children() > 0)
                this.alarms_scroll_wrapper.actor.show();
            this.add_alarm_item.actor.grab_key_focus();
            editor.actor.destroy();
        });
    },

    // input is either an alarm or an index into cache.alarms
    _add_alarm: function (a) {
        let alarm;

        // Every time we load/add/update a new alarm, we recompute a new ID.
        // This avoids any possibility of executing the same alarms multiple
        // times since alarms that were previously scheduled are still in the
        // mainloop.
        // We check if the alarm is in the cache, or if it's is a new alarm.
        if (typeof(a) === 'number') {
            this._store_cache();
            alarm = this.cache.alarms[a];
        }
        else {
            this.cache.alarms.push(a);
            this._store_cache();
            alarm = a;
        }

        this._schedule_alarm(alarm);

        this._update_panel_item_UI();

        let alarm_item = new AlarmItem(this.ext, this, alarm);
        this.alarms_scroll_content.add_actor(alarm_item.actor);
        this.alarms_scroll_wrapper.actor.show();

        alarm_item.connect('alarm-toggled', Lang.bind(this, function () {
            if (alarm.ID) Mainloop.source_remove(alarm.ID);
            if (alarm.toggle) this._schedule_alarm(alarm);
            this._update_panel_item_UI();
            this._store_cache();
        }));
    },

    _delete_alarm: function (alarm) {
        if (alarm.ID) Mainloop.source_remove(alarm.ID);

        for (let i = 0, len = this.cache.alarms.length; i < len; i++) {
            if (this.cache.alarms[i].ID === alarm.ID) {
                this.cache.alarms.splice(i, 1);
                break;
            }
        }

        this._store_cache();
        this._update_panel_item_UI();

        if (this.alarms_scroll_content.get_n_children() === 0)
            this.alarms_scroll_wrapper.actor.hide();
    },

    // @alarm : alarm object.
    // @time  : natural represeting seconds.
    //
    // If @time is given, the alarm will be scheduled @time seconds into
    // the future.
    // If @time is not given, the alarm will be scheduled according to it's
    // time_str.
    _schedule_alarm: function (alarm, time) {
        if (! alarm.toggle) return;

        if (! time) {
            let [future_hr, future_min] = alarm.time_str.split(':');
            let future_time = (future_hr * 3600) + (future_min * 60);

            let now = new Date();
            let hr  = now.getHours();
            let min = now.getMinutes();
            let sec = now.getSeconds();
            let current_time = (hr * 3600) + (min * 60) + sec + 1;

            time = (86400 - current_time + future_time) % 86400;

            if (time === 0) time = 86400;
        }

        alarm.ID = Mainloop.timeout_add_seconds(time, () => {
            if (alarm.days.indexOf(new Date().getDay()) >= 0) {
                this._send_notif(alarm);
                this._schedule_alarm(alarm);
            }
        });
    },

    _send_notif: function (alarm) {
        let source = new MessageTray.Source();
        Main.messageTray.add(source);

        let icon = new St.Icon();
        ICON_FROM_URI.icon_from_uri(icon, ALARM_ICON, this.ext_dir);

        // TRANSLATORS: %s is a time string in the format HH:MM (e.g., 13:44)
        let title = _('Alarm at %s').format(alarm.time_str);

        let params = {
            bannerMarkup : true,
            gicon        : icon.gicon,
        };

        let sound_file = this.settings.get_string('alarms-sound-file-path')
                                      .replace(/^.+?\/\//, '');

        if (this.settings.get_boolean('alarms-play-sound') && sound_file) {
            params.soundFile = sound_file;
        }

        let notif = new MessageTray.Notification(source,
                                                 title,
                                                 alarm.msg,
                                                 params);

        notif.setUrgency(MessageTray.Urgency.CRITICAL);

        notif.addAction(_('Snooze'), () => {
            if (alarm.ID) Mainloop.source_remove(alarm.ID);
            this._schedule_alarm(alarm,
                this.settings.get_int('alarms-snooze-duration'));
        });

        source.notify(notif);
    },

    _update_panel_item_UI: function () {
        this.panel_item.actor.remove_style_class_name('on');

        for (let i = 0, len = this.cache.alarms.length; i < len; i++) {
            if (this.cache.alarms[i].toggle) {
                this.panel_item.actor.add_style_class_name('on');
                break;
            }
        }
    },

    _update_panel_icon_name: function () {
        ICON_FROM_URI.icon_from_uri(this.panel_item.icon, ALARM_ICON, this.ext_dir);
    },

    _toggle_keybindings: function (disable_all) {
        if (!disable_all &&
            this.settings.get_strv('alarms-keybinding-open')[0] !== '') {

            this.keybindings.push('alarms-keybinding-open');

            Main.wm.addKeybinding(
                'alarms-keybinding-open',
                this.settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => { this.ext.open_menu(this); });
        }
        else {
            let i = this.keybindings.indexOf('alarms-keybinding-open');
            if (i !== -1) {
                Main.wm.removeKeybinding('alarms-keybinding-open');
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
        for (let i = 0, len = this.cache.alarms.length; i < len; i++) {
            let it = this.cache.alarms[i];

            if (it.ID) {
                Mainloop.source_remove(it.ID);
                it.ID = null;
            }
        }

        this.alarms_scroll_content.destroy_all_children();
        this._store_cache();
        this.sigm.disconnect_all();
        this._toggle_keybindings(true);
    },
});
Signals.addSignalMethods(Alarms.prototype);



// =====================================================================
// @@@ Alarm Editor
//
// @ext   : obj  (main ext object)
// @alarm : obj  (alarm object)
//
// @signals: 'add-alarm', 'edited-alarm', 'delete-alarm', 'cancel'
//
// If @alarm is given, it's time_str, days, and msg will be updated, and the
// alarm editor widget will be pre-populated with the alarms settings; otherwise,
// a complete new alarm object will be returned with the 'add-alarm' signal.
// =====================================================================
const AlarmEditor = new Lang.Class({
    Name: 'Timepp.AlarmEditor',

    _init: function(ext, alarm) {
        //
        // container
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content'});
        this.actor.add_actor(this.content_box);


        //
        // time pad
        //
        this.alarms_numpicker_box  = new St.BoxLayout({style_class: 'row numpicker-box'});
        this.content_box.add_actor(this.alarms_numpicker_box);

        this.hh_bin = new St.Bin({x_align: 1});
        this.alarms_numpicker_box.add(this.hh_bin, {expand: true});

        this.hh  = new NUM_PICKER.NumPicker(0, 23);
        this.hh_bin.add_actor(this.hh.actor);

        this.mm_bin = new St.Bin({x_align: 1});
        this.alarms_numpicker_box.add(this.mm_bin, {expand: true});

        this.mm = new NUM_PICKER.NumPicker(0, 59);
        this.mm_bin.add_actor(this.mm.actor);

        if (alarm) {
            let [hr_str, min_str] = alarm.time_str.split(':');
            this.hh._set_counter(parseInt(hr_str));
            this.mm._set_counter(parseInt(min_str));
        }


        //
        // choose day
        //
        this.day_chooser = new DAY_CHOOSER.DayChooser(alarm ? false : true);
        this.content_box.add_actor(this.day_chooser.actor);

        if (alarm) {
            for (let i = 0; i < alarm.days.length; i++) {
                let btn = this.day_chooser.actor.get_child_at_index(alarm.days[i]);
                btn.checked = true;
                btn.add_style_pseudo_class('active');
            }
        }


        //
        // entry
        //
        this.alarm_entry_container = new St.BoxLayout({ vertical: true, style_class: 'row entry-container' });
        this.content_box.add_actor(this.alarm_entry_container);
        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Alarm Message...'), false, false);

        this.alarm_entry_container.add_actor(this.entry.actor);

        if (alarm) {
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
                this.entry.entry.set_text(alarm.msg);
            }));

            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
                this.entry._resize_entry();
            }));
        }


        //
        // buttons
        //
        let btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add_actor(btn_box);

        if (alarm) {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            btn_box.add(this.button_delete, {expand: true});

            this.button_delete.connect('clicked', Lang.bind(this, function () {
                this.emit('delete-alarm');
            }));
        };

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        this.button_ok     = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        btn_box.add(this.button_cancel, {expand: true });
        btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', () => {
            if (alarm) {
                alarm.time_str = this._get_time_str(),
                alarm.msg      = this.entry.entry.get_text(),
                alarm.days     = this._get_days(),

                this.emit('edited-alarm', alarm);
            }
            else {
                this.emit('add-alarm', {
                    time_str: this._get_time_str(),
                    msg:      this.entry.entry.get_text(),
                    days:     this._get_days(),
                    toggle:   true,
                });
            }
        });
        this.button_cancel.connect('clicked', () => {
            this.emit('cancel');
        });
    },

    _get_days: function () {
        let days = [];

        for (let i = 0; i < 7; i++) {
            let btn = this.day_chooser.actor.get_child_at_index(i);
            if (btn.checked) days.push(i);
        }

        return days;
    },

    _get_time_str: function () {
        return this.hh.counter_label.get_text() + ':' +
               this.mm.counter_label.get_text();
    },
});
Signals.addSignalMethods(AlarmEditor.prototype);



// =====================================================================
// @@@ Alarm Item
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @alarm    : obj (an alarm object)
//
// signals: 'alarm-toggled'
// =====================================================================
const AlarmItem = new Lang.Class({
    Name: 'Timepp.AlarmItem',

    _init: function(ext, delegate, alarm) {
        this.ext      = ext;
        this.delegate = delegate;
        this.alarm    = alarm;


        this.msg_vert_padding = -1;


        //
        // container
        //
        this.actor = new St.BoxLayout({ reactive: true, vertical:true, style_class: 'alarm-item menu-favorites-box' });

        this.alarm_item_content = new St.BoxLayout({vertical: true, style_class: 'alarm-item-content'});
        this.actor.add_actor(this.alarm_item_content);


        //
        // header
        //
        this.header = new St.BoxLayout({style_class: 'alarm-item-header'});
        this.alarm_item_content.add_actor(this.header);


        this.time = new St.Label({ text: alarm.time_str, y_align: St.Align.END, x_align: St.Align.START, style_class: 'alarm-item-time' });
        this.header.add(this.time, {expand: true});

        this.option_box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER, style_class: 'option-box'});
        this.header.add_actor(this.option_box);

        let edit_icon = new St.Icon();
        ICON_FROM_URI.icon_from_uri(edit_icon, EDIT_ICON, this.delegate.ext_dir);
        this.edit_bin = new St.Button({ visible: false, can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'settings-icon'});
        this.edit_bin.add_actor(edit_icon);

        this.option_box.add(this.edit_bin);

        this.toggle     = new PopupMenu.Switch(alarm.toggle);
        this.toggle_bin = new St.Button({y_align: St.Align.START, x_align: St.Align.END });
        this.toggle.actor.can_focus = true;
        this.toggle_bin.add_actor(this.toggle.actor);

        this.option_box.add(this.toggle_bin);


        //
        // body
        //
        this.msg = new St.Label({ y_align: St.Align.END, x_align: St.Align.START, style_class: 'alarm-item-message'});
        this.alarm_item_content.add_actor(this.msg);

        if (!alarm.msg) this.msg.hide();
        else this.msg.clutter_text.set_markup(alarm.msg);

        this.msg.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        this.msg.clutter_text.set_single_line_mode(false);
        this.msg.clutter_text.set_line_wrap(true);
        this.msg.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);


        //
        // listen
        //
        this.toggle_bin.connect('clicked', () => { this._on_toggle(); });
        this.edit_bin.connect('clicked',   () => { this._on_edit(); });
        this.actor.connect('queue-redraw', () => { this._resize_alarm_item(); });
        this.actor.connect('enter-event',  () => { this.edit_bin.show(); });
        this.actor.connect('event', (actor, event) => {
            this._on_event(actor, event);
        });
    },

    _on_toggle: function () {
        this.toggle.toggle();
        this.alarm.toggle = !this.alarm.toggle;
        this.emit('alarm-toggled');
    },

    _on_edit: function () {
        this.delegate.alarm_editor(this);
    },

    _resize_alarm_item: function () {
        let theme_node = this.msg.get_theme_node();
        let alloc_box  = this.msg.get_allocation_box();

        // gets the acutal width of the box
        let width = alloc_box.x2 - alloc_box.x1;

        // remove paddings and borders
        width = theme_node.adjust_for_width(width);

        // nat_height is the minimum height needed to fit the multiline text
        // **excluding** the vertical paddings/borders.
        let [min_height, nat_height] = this.msg.clutter_text.get_preferred_height(width);

        // The vertical padding can only be calculated once the box is painted.
        // nat_height_adjusted is the minimum height needed to fit the multiline
        // text **including** vertical padding/borders.
        if (this.msg_vert_padding < 0) {
            let [min_height_adjusted, nat_height_adjusted] = theme_node.adjust_preferred_height(min_height, nat_height);
            this.msg_vert_padding = nat_height_adjusted - nat_height;
        }

        this.msg.set_height(nat_height + this.msg_vert_padding);
    },

    _on_event: function (actor, event) {
        switch (event.type()) {
            case Clutter.EventType.ENTER: {
                this.edit_bin.show();
                break;
            }

            case Clutter.EventType.LEAVE: {
                if (! this.header.contains(global.stage.get_key_focus()))
                    this.edit_bin.hide();
                break;
            }

            case Clutter.EventType.KEY_RELEASE: {
                this.edit_bin.show();
                SCROLL_TO_ITEM.scroll(this.delegate.alarms_scroll,
                                      this.delegate.alarms_scroll_content,
                                      actor);
                break;
            }

            case Clutter.EventType.KEY_PRESS: {
                Mainloop.idle_add(() => {
                    if (! this.header.contains(global.stage.get_key_focus()))
                        this.edit_bin.hide();
                });
                break;
            }
        }
    },
});
Signals.addSignalMethods(AlarmItem.prototype);
