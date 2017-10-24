const St        = imports.gi.St;
const Gio       = imports.gi.Gio;
const GLib      = imports.gi.GLib;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Lang      = imports.lang;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const SIG_MANAGER = ME.imports.lib.signal_manager;
const PANEL_ITEM  = ME.imports.lib.panel_item;


const ContextMenu = ME.imports.sections.context_menu;
const Timer       = ME.imports.sections.timer;
const Stopwatch   = ME.imports.sections.stopwatch;
const Pomodoro    = ME.imports.sections.pomodoro;
const Alarms      = ME.imports.sections.alarms;
const Todo        = ME.imports.sections.todo.MAIN;


const Gettext = imports.gettext;
Gettext.bindtextdomain(ME.metadata['gettext-domain'], ME.path + '/locale');


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
        this.parent(0.5, 'Timepp');


        this.actor.style_class = '';
        this.actor.can_focus   = false;
        this.actor.reactive    = false;
        this.menu.actor.add_style_class_name('timepp-menu');


        {
            let GioSSS = Gio.SettingsSchemaSource;
            let schema = GioSSS.new_from_directory(
                ME.path + '/data/schemas', GioSSS.get_default(), false);
            schema = schema.lookup('org.gnome.shell.extensions.timepp', false);

            this.settings = new Gio.Settings({ settings_schema: schema });
        }


        this.sigm                = new SIG_MANAGER.SignalManager();
        this.section_register    = [];
        this.separator_register  = [];
        this.panel_item_position = this.settings.get_enum('panel-item-position');
        this.custom_stylesheet   = null;
        this.theme_change_signal_block = false;


        // ensure cache dir
        {
            let dir = Gio.file_new_for_path(
                `${GLib.get_home_dir()}/.cache/timepp_gnome_shell_extension`);

            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
        }


        //
        // panel actor
        //
        this.panel_item_box = new St.BoxLayout({ style_class: 'timepp-panel-box'});
        this.actor.add_actor(this.panel_item_box);


        //
        // unicon panel item (shown when single panel item mode is selected)
        //
        this.unicon_panel_item = new PANEL_ITEM.PanelItem(this.menu);
        this.unicon_panel_item.icon.icon_name = 'timepp-unicon-symbolic';

        this.unicon_panel_item.set_mode('icon');
        this.unicon_panel_item.actor.add_style_class_name('unicon-panel-item');

        if (! this.settings.get_boolean('unicon-mode')) this.unicon_panel_item.actor.hide();

        this.panel_item_box.add_child(this.unicon_panel_item.actor);


        //
        // popup menu
        //
        this.content_box = new St.BoxLayout({ style_class: 'timepp-content-box', vertical: true});
        this.menu.box.add_child(this.content_box);


        //
        // context menu
        //
        this.context_menu = new ContextMenu.ContextMenu(this);
        this.content_box.add_actor(this.context_menu.actor);
        this.context_menu.actor.hide();


        //
        // init sections
        //
        this.timer_section = new Timer.Timer(this, this.settings);
        this.section_register.push(this.timer_section);

        this.stopwatch_section = new Stopwatch.Stopwatch(this, this.settings);
        this.section_register.push(this.stopwatch_section);

        this.pomodoro_section = new Pomodoro.Pomodoro(this, this.settings);
        this.section_register.push(this.pomodoro_section);

        this.alarms_section = new Alarms.Alarms(this, this.settings);
        this.section_register.push(this.alarms_section);

        this.todo_section = new Todo.Todo(this, this.settings);
        this.section_register.push(this.todo_section);

        for (let i = 0, len = this.section_register.length; i < len; i++) {
            let section = this.section_register[i];

            section.actor.hide();
            this.content_box.add_actor(section.actor);

            if (i !== len - 1) {
                let sep = new PopupMenu.PopupSeparatorMenuItem();
                sep.actor.add_style_class_name('timepp-separator');
                this.separator_register.push(sep.actor);
                this.content_box.add_actor(sep.actor);
            }
        }


        //
        // more init
        //
        this.update_panel_items();
        Mainloop.idle_add(() => this._load_stylesheet());


        //
        // listen
        //
        this.sigm.connect(this.settings, 'changed::timer-enabled', () => {
            this.timer_section.toggle_section();
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-enabled', () => {
            this.stopwatch_section.toggle_section();
        });
        this.sigm.connect(this.settings, 'changed::pomodoro-enabled', () => {
            this.pomodoro_section.toggle_section();
        });
        this.sigm.connect(this.settings, 'changed::alarms-enabled', () => {
            this.alarms_section.toggle_section();
        });
        this.sigm.connect(this.settings, 'changed::todo-enabled', () => {
            this.todo_section.toggle_section();
        });
        this.sigm.connect(St.ThemeContext.get_for_stage(global.stage), 'changed', () => {
            if (this.theme_change_signal_block) return;
            this._on_theme_changed();
        });
        this.sigm.connect(this.settings, 'changed::panel-item-position', () => {
            let new_val = this.settings.get_enum('panel-item-position');
            this._on_panel_position_changed(this.panel_item_position, new_val);
            this.panel_item_position = new_val;
        });
        this.sigm.connect(this.settings, 'changed::unicon-mode', () => {
            this.update_panel_items();
        });
        this.sigm.connect(this.unicon_panel_item.actor, 'key-focus-in', () => {
            // user has right-clicked to show the context menu
            if (this.menu.isOpen && this.context_menu.actor.visible)
                return;

            this.open_menu();
        });
        this.sigm.connect(this.unicon_panel_item, 'left-click', () => {
            this.toggle_menu();
        });
        this.sigm.connect(this.unicon_panel_item, 'right-click', () => {
            this.toggle_context_menu();
        });
        this.sigm.connect(this.pomodoro_section, 'stop-time-tracking', () => {
            this.emit('stop-time-tracking');
        });
        this.sigm.connect(this.menu, 'open-state-changed', (_, state) => {
            if (state) return Clutter.EVENT_PROPAGATE;

            this.context_menu.actor.hide();
            this.unicon_panel_item.actor.remove_style_pseudo_class('checked');
            this.unicon_panel_item.actor.can_focus = true;

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                let section = this.section_register[i];

                if (! section.section_enabled) continue;

                section.panel_item.actor.remove_style_pseudo_class('checked');
                section.panel_item.actor.can_focus = true;

                if (section.actor.visible) {
                    section.on_section_open_state_changed(false);
                    section.actor.visible = false;
                }
            }
        });
    },

    toggle_menu: function (section) {
        if (this.menu.isOpen) {
            this.menu.close(false);
        }
        else {
            this.open_menu(section);
        }
    },

    // @section: obj (a section's main object)
    //
    // - If @section is null, then that is assumed to mean that the unicon icon
    //   has been clicked/activated (i.e., we show all joined menus.)
    //
    // - If @section is provided, then the menu will open to show that section.
    //     - If @section is a separate menu, we show it and hide all other menus.
    //
    //     - If @section is not a sep menu, we show all joined sections that
    //       are enabled.
    open_menu: function (section) {
        this.unicon_panel_item.actor.remove_style_pseudo_class('checked');
        this.unicon_panel_item.actor.can_focus = true;

        // Track sections whose state has changed and call their
        // on_section_open_state_changed method after the menu has been shown.
        let shown_sections  = [];
        let hidden_sections = [];

        if (!section || !section.separate_menu) {
            if (this.unicon_panel_item.actor.visible) {
                this._update_menu_arrow(this.unicon_panel_item.actor);
                this.unicon_panel_item.actor.add_style_pseudo_class('checked');
                this.unicon_panel_item.actor.can_focus = false;
            }
            else {
                this._update_menu_arrow(section.panel_item.actor);
            }

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                section = this.section_register[i];

                if (! section.section_enabled) continue;

                if (section.separate_menu) {
                    if (section.actor.visible) {
                        hidden_sections.push(section);
                        section.actor.hide();
                    }
                }
                else if (! section.actor.visible) {
                    shown_sections.push(section);
                    section.actor.visible = true;
                }
            }
        }
        else if (section.separate_menu) {
            this._update_menu_arrow(section.panel_item.actor);

            let name = section.__name__;

            if (! section.actor.visible) {
                shown_sections.push(section);
                section.actor.visible = true;
            }

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                section = this.section_register[i];

                if (name === section.__name__ ||
                    !section.section_enabled  ||
                    !section.actor.visible) continue;

                hidden_sections.push(section);
                section.actor.visible = false;
            }
        }

        this._update_separators();
        this.menu.open();

        for (let i = 0; i < shown_sections.length; i++)
            shown_sections[i].on_section_open_state_changed(true);

        for (let i = 0; i < hidden_sections.length; i++)
            hidden_sections[i].on_section_open_state_changed(false);
    },

    _update_menu_arrow: function (source_actor) {
        if (this.menu.isOpen)
            this.menu._boxPointer.setPosition(source_actor, this.menu._arrowAlignment);
        else
            this.menu.sourceActor = source_actor;
    },

    toggle_context_menu: function (section) {
        if (this.menu.isOpen) {
            this.menu.close(false);
            return;
        }

        if (section) this._update_menu_arrow(section.panel_item.actor);
        else         this._update_menu_arrow(this.unicon_panel_item.actor);

        this.context_menu.actor.visible = true;
        this.unicon_panel_item.actor.add_style_pseudo_class('checked');
        this.unicon_panel_item.actor.can_focus = false;

        for (let i = 0, len = this.section_register.length; i < len; i++) {
            let section = this.section_register[i];

            if (section.panel_item.actor.visible) {
                section.panel_item.actor.add_style_pseudo_class('checked');
                section.panel_item.actor.can_focus = false;
            }
        }

        this._update_separators();
        this.menu.open(false);
    },

    _update_separators: function () {
        let any_prev_visible = this.section_register[0].actor.visible;

        for (let i = 0; i < this.separator_register.length; i++) {
            if (this.section_register[i + 1].actor.visible) {
                this.separator_register[i].visible = any_prev_visible;
                any_prev_visible = true;
            }
            else {
                this.separator_register[i].visible = false;
            }
        }
    },

    update_panel_items: function () {
        if (this.settings.get_boolean('unicon-mode')) {
            let show_unicon = false;

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                let section = this.section_register[i];

                if (! section.section_enabled) {
                    section.panel_item.actor.hide();
                }
                else if (section.separate_menu) {
                    section.panel_item.actor.show();
                }
                else {
                    section.panel_item.actor.hide();
                    show_unicon = true;
                }
            }

            this.unicon_panel_item.actor.visible = show_unicon;
        }
        else {
            this.unicon_panel_item.actor.hide();

            for (let i = 0, len = this.section_register.length; i < len; i++) {
                let section = this.section_register[i];
                section.panel_item.actor.visible = section.section_enabled;
            }
        }
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
        this.theme_change_signal_block = true;

        // determine custom stylesheet
        {
            let stylesheet = Main.getThemeStylesheet();
            let path       = stylesheet ? stylesheet.get_path() : '';
            let theme_dir  = path ? GLib.path_get_dirname(path) : '';

            if (theme_dir) {
                this.custom_stylesheet =
                    Gio.file_new_for_path(theme_dir + '/timepp.css');
            }

            if (!this.custom_stylesheet ||
                !this.custom_stylesheet.query_exists(null)) {

                this.custom_stylesheet =
                    Gio.File.new_for_path(ME.path + '/stylesheet.css');
            }
        }

        // load custom stylesheet
        St.ThemeContext.get_for_stage(global.stage).get_theme()
            .load_stylesheet(this.custom_stylesheet);

        // reload theme
        Main.reloadThemeResource();
        Main.loadTheme();

        Mainloop.idle_add(() => this.theme_change_signal_block = false);
    },

    _unload_stylesheet: function () {
        if (! this.custom_stylesheet) return;

        St.ThemeContext.get_for_stage(global.stage).get_theme()
            .unload_stylesheet(this.custom_stylesheet);

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

    destroy: function () {
        for (let i = 0, len = this.section_register.length; i < len; i++) {
            if (this.section_register[i].section_enabled)
                this.section_register[i].disable_section();
        }

        this._unload_stylesheet();
        this.sigm.clear();
        this.parent();
    },
});



// =====================================================================
// @@@ Init
// =====================================================================
function init () {}

let timepp;

function enable () {
    timepp = new Timepp();

    {
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

    // To make it easier to use custom icons, we just append the img dir to the
    // search paths of the default icon theme.
    // To avoid issues, we prefix the file names of our custom symbolic icons
    // with 'timepp-'.
    {
        let icon_theme = imports.gi.Gtk.IconTheme.get_default();
        icon_theme.prepend_search_path(ME.path + '/data/img/icons');
    }
}

function disable () {
    // remove the custom search path
    {
        let icon_theme  = imports.gi.Gtk.IconTheme.get_default();
        let custom_path = ME.path + '/data/img/icons';
        let paths       = icon_theme.get_search_path();
        paths.splice(paths.indexOf(custom_path), 1);
        icon_theme.set_search_path(paths);
    }

    timepp.destroy();
    timepp = null;
}
