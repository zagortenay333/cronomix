const St             = imports.gi.St;
const Gio            = imports.gi.Gio;
const GLib           = imports.gi.GLib;
const Clutter        = imports.gi.Clutter;
const Main           = imports.ui.main;
const PopupMenu      = imports.ui.popupMenu;
const PanelMenu      = imports.ui.panelMenu;
const Lang           = imports.lang;
const Util           = imports.misc.util;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const CONVENIENCE   = ME.imports.lib.convenience;
const PANEL_ITEM    = ME.imports.lib.panel_item;
const ICON_FROM_URI = ME.imports.lib.icon_from_uri;

const Timer     = ME.imports.sections.timer;
const Stopwatch = ME.imports.sections.stopwatch;
const Pomodoro  = ME.imports.sections.pomodoro;
const Alarms    = ME.imports.sections.alarms;
const Todo      = ME.imports.sections.todo;


const Gettext = imports.gettext;

Gettext.textdomain(ME.metadata['gettext-domain']);
Gettext.bindtextdomain(ME.metadata['gettext-domain'], ME.dir.get_path() + '/locale');

const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const UNICON_ICON = '/img/unicon-symbolic.svg';


const PanelPosition = {
    LEFT   : 0,
    CENTER : 1,
    RIGHT  : 2,
};


// =====================================================================
// @@@ Main extension object
// =====================================================================
const Timepp = new Lang.Class({
    Name    : 'Timepp.Timepp',
    Extends : PanelMenu.Button,

    _init: function () {
        this.parent(0.5, _('Timepp'));


        this.settings = new CONVENIENCE.getSettings('org.gnome.shell.extensions.timepp');
        this.section_register    = [];
        this.separator_register  = [];
        this.panel_item_position = this.settings.get_enum('panel-item-position');
        this.custom_stylesheet   = null;
        this.theme_change_signal_temp_block = false;


        //
        // ensure cache dir
        //
        Util.spawnCommandLine("mkdir -p %s".format(
            GLib.get_home_dir() + '/.cache/timepp_gnome_shell_extension'));


        //
        // allow custom theme support
        //
        this._load_stylesheet();


        //
        // panel actor
        //
        this.actor.style_class = '';
        this.menu.actor.add_style_class_name('timepp-menu');

        this.panel_item_box = new St.BoxLayout({ style_class: 'timepp-panel-box'});
        this.actor.add_actor(this.panel_item_box);


        //
        // unicon panel item (shown when single panel item mode is selected)
        //
        this.unicon_panel_item = new PANEL_ITEM.PanelItem(this.menu);

        this.unicon_panel_item.set_mode('icon');
        this.unicon_panel_item.actor.add_style_class_name('unicon-panel-item');
        this._update_unicon_name();

        if (! this.settings.get_boolean('unicon-mode')) this.unicon_panel_item.actor.hide();

        this.panel_item_box.add_child(this.unicon_panel_item.actor);


        //
        // popup menu
        //
        this.content_box = new St.BoxLayout({ style_class: 'timepp-content-box', vertical: true});
        this.menu.box.add_child(this.content_box);


        //
        // init sections
        //
        this.timer_section = new Timer.Timer(this, ME.path, this.settings);
        this.content_box.add_actor(this.timer_section.actor);
        this.section_register.push(this.timer_section);
        this._add_separator(this.content_box);

        this.stopwatch_section = new Stopwatch.Stopwatch(this, ME.path, this.settings);
        this.content_box.add_actor(this.stopwatch_section.actor);
        this.section_register.push(this.stopwatch_section);
        this._add_separator(this.content_box);

        this.pomodoro_section = new Pomodoro.Pomodoro(this, ME.path, this.settings);
        this.content_box.add_actor(this.pomodoro_section.actor);
        this.section_register.push(this.pomodoro_section);
        this._add_separator(this.content_box);

        this.alarms_section = new Alarms.Alarms(this, ME.path, this.settings);
        this.content_box.add_actor(this.alarms_section.actor);
        this.section_register.push(this.alarms_section);
        this._add_separator(this.content_box);

        this.todo_section = new Todo.Todo(this, ME.path, this.settings);
        this.content_box.add_actor(this.todo_section.actor);
        this.section_register.push(this.todo_section);


        //
        // Hide panel items of sections that are not enabled or hide all if
        // unicon mode is on.
        //
        for (let i = 0, len = this.section_register.length; i < len; i++) {
            let section = this.section_register[i];

            if ((! section.section_enabled) || this.settings.get_boolean('unicon-mode'))
                section.panel_item.actor.hide();
        }


        //
        // listen
        //
        this.theme_change_sig_id =
        St.ThemeContext.get_for_stage(global.stage).connect('changed', () => {
            if (this.theme_change_signal_temp_block)
                return;

            this._on_theme_changed();
        });
        this.settings.connect('changed::panel-item-position', () => {
            let new_val = this.settings.get_enum('panel-item-position');
            this._on_panel_position_changed(this.panel_item_position, new_val);
            this.panel_item_position = new_val;
        });
        this.settings.connect('changed::unicon-mode', () => {
            this._toggle_unicon_mode();
        });
        this.unicon_panel_item.connect('click', () => {
            this.toggle_menu();
        });
        this.timer_section.connect('toggle-menu', () => {
            this.toggle_menu(this.timer_section);
        });
        this.stopwatch_section.connect('toggle-menu', () => {
            this.toggle_menu(this.stopwatch_section);
        });
        this.pomodoro_section.connect('toggle-menu', () => {
            this.toggle_menu(this.pomodoro_section);
        });
        this.pomodoro_section.connect('stop-time-tracking', () => {
            this.emit('stop-time-tracking');
        });
        this.alarms_section.connect('toggle-menu', () => {
            this.toggle_menu(this.alarms_section);
        });
        this.todo_section.connect('toggle-menu', () => {
            this.toggle_menu(this.todo_section);
        });
    },

    toggle_menu: function (section) {
        if (this.menu.isOpen) this.menu.close(false);
        else                  this.open_menu(section);
    },

    // @section: obj (a section's main object)
    //
    // - If @section is omitted, then all enabled sections will be shown.
    //
    // - If @section is provided, then the menu will open to show that section.
    //     - If @section is a separate menu, we show it and hide all other menus.
    //
    //     - If @section is not a sep menu, we show all non-separate menus that
    //       are enabled.
    open_menu: function (section) {
        if (this.unicon_panel_item.actor.visible) {
            this.menu.sourceActor = this.unicon_panel_item.actor;

            this.unicon_panel_item.menu_toggled(true);

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                section = this.section_register[i];
                section.actor.visible = section.section_enabled;
            }
        }
        else if (section.separate_menu) {
            this.menu.sourceActor = section.panel_item.actor;

            let name = section.__name__;

            section.actor.show();
            section.panel_item.menu_toggled(true);

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                section = this.section_register[i];

                if (name !== section.__name__) {
                    section.actor.hide();
                    section.panel_item.menu_toggled(false)
                }
            }
        }
        else {
            this.menu.sourceActor = section.panel_item.actor;

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                section = this.section_register[i];

                if ( section.separate_menu || (! section.section_enabled) ) {
                    section.actor.hide();
                    section.panel_item.menu_toggled(false)
                }
                else {
                    section.actor.show();
                    section.panel_item.menu_toggled(true)
                }
            }
        }

        this._update_separators();
        this.menu.open();
    },

    _update_separators: function () {
        let reg  = this.section_register;
        let flag = reg[0].actor.visible;
        let len  = this.section_register.length;

        for (let i = 1; i < len; i++) {
            if (reg[i].actor.visible) {
                if (flag)
                    this.separator_register[i - 1].show();
                else
                    this.separator_register[i - 1].hide();

                flag = true;
            }
            else
                this.separator_register[i - 1].hide();
        }
    },

    _add_separator: function (container) {
        let sep = new PopupMenu.PopupSeparatorMenuItem();
        sep.actor.add_style_class_name('timepp-separator');

        this.separator_register.push(sep.actor);

        container.add_actor(sep.actor);
    },

    _toggle_unicon_mode: function () {
        if (this.settings.get_boolean('unicon-mode')) {
            this.unicon_panel_item.actor.show();

            for (let i = 0, len = this.section_register.length; i < len; i++)
                this.section_register[i].panel_item.actor.hide();

        }
        else {
            this.unicon_panel_item.actor.hide();

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                let section = this.section_register[i];
                if (section.section_enabled)
                    this.section_register[i].panel_item.actor.show();
            }
        }
    },

    _update_unicon_name: function() {
        ICON_FROM_URI.icon_from_uri(this.unicon_panel_item.icon, UNICON_ICON, ME.path);
    },

    _on_panel_position_changed: function (old_pos, new_pos) {
        let ref = this.container;

        switch (old_pos) {
            case PanelPosition.LEFT:
                Main.panel._leftBox.remove_child(this.container);
                break;
            case PanelPosition.CENTER:
                Main.panel._centerBox.remove_child(this.container);
                break;
            case PanelPosition.RIGHT:
                Main.panel._rightBox.remove_child(this.container);
                break;
        }

        switch (new_pos) {
            case PanelPosition.LEFT:
                Main.panel._leftBox.add_child(ref);
                break;
            case PanelPosition.CENTER:
                Main.panel._centerBox.add_child(ref);
                break;
            case PanelPosition.RIGHT:
                Main.panel._rightBox.insert_child_at_index(ref, 0);
        }
    },

    _on_theme_changed: function () {
        if (this.custom_stylesheet) this._unload_stylesheet();
        this._load_stylesheet();
    },

    _load_stylesheet: function () {
        this.theme_change_signal_temp_block = true;

        let stylesheet = Main._defaultCssStylesheet;

        if (Main._cssStylesheet)
            stylesheet = Main._cssStylesheet;

        let theme_dir = stylesheet.get_path();
        theme_dir = theme_dir ? GLib.path_get_dirname(theme_dir) : '';

        if (theme_dir !== '')
            this.custom_stylesheet = Gio.file_new_for_path(theme_dir + '/timepp.css');

        if (!this.custom_stylesheet || !this.custom_stylesheet.query_exists(null)) {
            let default_stylesheet = Gio.File.new_for_path(ME.path + '/stylesheet.css');

            if (default_stylesheet.query_exists(null))
                this.custom_stylesheet = default_stylesheet;
            else
                return;
        }

        let theme_context = St.ThemeContext.get_for_stage(global.stage);
        if (! theme_context)
            return;

        let theme = theme_context.get_theme();
        if (! theme)
            return;

        theme.load_stylesheet(this.custom_stylesheet);


        // reload theme
        Main.reloadThemeResource();
        Main.loadTheme();

        Mainloop.idle_add(() => {
            this.theme_change_signal_temp_block = false;
        });
    },

    _unload_stylesheet: function () {
        if (! this.custom_stylesheet)
            return;

        let theme_context = St.ThemeContext.get_for_stage(global.stage);
        if (! theme_context)
            return;

        let theme = theme_context.get_theme();
        if (! theme)
            return;

        theme.unload_stylesheet(this.custom_stylesheet);

        this.custom_stylesheet = null;
    },

    // @HACK
    // ScrollView always allocates horizontal space for the scrollbar when the
    // policy is set to AUTOMATIC. The result is an ugly padding on the right
    // when the scrollbar is invisible.
    // To work around this, we can use this function to figure out whether or
    // not we need a scrollbar and then show it manually.
    // This works because we only need to show the scrollbar of a scrollview
    // in the popup when the popup menu exceeds it's max height which is roughly
    // the height of the monitor.
    needs_scrollbar: function () {
        let [min_height, nat_height] = this.menu.actor.get_preferred_height(-1);
        let max_height = this.menu.actor.get_theme_node().get_max_height();

        return max_height >= 0 && min_height >= max_height;
    },

    destroy: function() {
        this.timer_section.disable_section();
        this.stopwatch_section.disable_section();
        this.pomodoro_section.disable_section();
        this.alarms_section.disable_section();
        this.todo_section.disable_section();
        if (this.theme_change_sig_id) {
            St.ThemeContext.get_for_stage(global.stage)
                           .disconnect(this.theme_change_sig_id);
        }
        this._unload_stylesheet();
        this.parent();
    },
});



// =====================================================================
// @@@ Init
// =====================================================================
function init () {}

let timepp;

function enable () {
    timepp = new Timepp;

    let pos;

    switch (timepp.settings.get_enum('panel-item-position')) {
        case PanelPosition.LEFT:
            pos = Main.panel._leftBox.get_n_children();
            Main.panel.addToStatusArea('timepp', timepp, pos, 'left');
            break;

        case PanelPosition.CENTER:
            pos = Main.panel._centerBox.get_n_children();
            Main.panel.addToStatusArea('timepp', timepp, pos, 'center');
            break;

        case PanelPosition.RIGHT:
            Main.panel.addToStatusArea('timepp', timepp, 0, 'right');
    }
}

function disable () {
    timepp.destroy();
    timepp = null;
}
