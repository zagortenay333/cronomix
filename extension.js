const St         = imports.gi.St;
const Gio        = imports.gi.Gio;
const GLib       = imports.gi.GLib;
const Shell      = imports.gi.Shell;
const Clutter    = imports.gi.Clutter;
const Main       = imports.ui.main;
const PopupMenu  = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const PanelMenu  = imports.ui.panelMenu;
const Mainloop   = imports.mainloop;
const GObject    = imports.gi.GObject


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext = imports.gettext;
Gettext.bindtextdomain(ME.metadata['gettext-domain'], ME.path + '/locale');


const SIG_MANAGER = ME.imports.lib.signal_manager;
const PANEL_ITEM  = ME.imports.lib.panel_item;
const MISC_UTILS  = ME.imports.lib.misc_utils;


// To add a section, add the module here, update the 'sections' entry in the
// gschema.xml file, and add a toggle to enable/disable it (update ui and
// prefs.js files).
const SECTIONS = new Map([
    ['Alarms'     , ME.imports.sections.alarms],
    ['Pomodoro'   , ME.imports.sections.pomodoro],
    ['Stopwatch'  , ME.imports.sections.stopwatch],
    ['Timer'      , ME.imports.sections.timer],
    ['Todo'       , ME.imports.sections.todo.MAIN],
]);

const ContextMenu = ME.imports.sections.context_menu;


const PanelPosition = {
    LEFT   : 0,
    CENTER : 1,
    RIGHT  : 2,
};

// =====================================================================
// @@@ Main extension object
// =====================================================================
var Timepp = GObject.registerClass({
    Signals: {
        'custom-css-changed': {},
        'start-time-tracking-by-id': { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
        'stop-time-tracking-by-id':  { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] }
    }
}, class Timepp extends PanelMenu.Button {
    _init () {
        // @HACK
        // This func only updates the max-height prop but not max-width.
        // We unset it and do our own thing.
        //
        // NOTE: Do this before calling the parent constructor because they use
        // bind() on the original func..
        this._onOpenStateChanged = () => false;
        super._init(0.5, 'Timepp');

        // @SPEED @HACK
        // - We patch the menu.open function to emit the 'open-state-changed'
        //   in a timeout.
        // - We remove the raise_top() func which causes a lot of lag and seems
        //   to be useless anyway.
        this.menu.open = function () {
            if (this.isOpen) return;
            this.isOpen = true;

            // @HACK
            // If an extension puts the panel to the bottom and updates the
            // _arrowSide prop, then the func _updateFlip() in boxpointer will
            // call _calculateArrowSide() and reset that prop if the menu is
            // higher than the monitor.
            // This will lead to the menu not being shown because it will be
            // rendered below the panel.
            //
            // I don't understand what the point of _calculateArrowSide() is..
            //
            // Since we patch the open() func, we have to include this hack here.
            let panel_pos = Main.layoutManager.panelBox.anchor_y == 0 ? St.Side.TOP : St.Side.BOTTOM;
            this._boxPointer._userArrowSide = panel_pos;
            this._boxPointer._arrowSide     = panel_pos;

            this._boxPointer.setPosition(this.sourceActor, this._arrowAlignment);

            // If there is another menu open, we emit 'open-state-changed' the
            // normal way to avoid any deadlocks.
            if (Main.panel.menuManager.activeMenu) {
                this._boxPointer.open(BoxPointer.PopupAnimation.FULL);
                this.emit('open-state-changed', true);
            } else {
                // Put in boxpointer callback to play nicely with animations.
                this._boxPointer.open(BoxPointer.PopupAnimation.FULL, () => {
                    let f = global.stage.get_key_focus();
                    Mainloop.timeout_add(0, () => {
                        this.emit('open-state-changed', true);
                        f.grab_key_focus();
                    });
                });
            }
        };

        this.style_class = '';
        this.can_focus   = false;
        this.reactive    = false;
        this.menu.actor.add_style_class_name('timepp-menu');


        this.panel_item_box = new St.BoxLayout({ style_class: 'timepp-panel-box timepp-custom-css-root'});
        this.add_actor(this.panel_item_box);


        this.markdown_map = new Map([
            ['`'   , ['', '']],
            ['``'  , ['<tt>', '</tt>']],

            ['*'   , ['<b>', '</b>']],
            ['**'  , ['<i>', '</i>']],
            ['***' , ['<b><span foreground="black" background="#e74f4f">', '</span></b>']],

            ['_'   , null],
            ['__'  , ['<i>', '</i>']],
            ['___' , ['<u>', '</u>']],

            ['~'   , null],
            ['~~'  , ['<s>', '</s>']],

            ['#'   , ['<span size="xx-large">', '</span>']],
            ['##'  , ['<span size="x-large">', '</span>']],
            ['###' , ['<span size="large">', '</span>']],
        ]);


        this.custom_css = {
            ['-timepp-link-color']       : ['blue'    , [0, 0, 1, 1]],

            ['-timepp-context-color']    : ['magenta' , [1, 0, 1, 1]],
            ['-timepp-due-date-color']   : ['red'     , [1, 0, 0, 1]],
            ['-timepp-project-color']    : ['green'   , [0, 1, 0, 1]],
            ['-timepp-rec-date-color']   : ['tomato'  , [1, .38, .28, 1]],
            ['-timepp-defer-date-color'] : ['violet'  , [.93, .51, .93, 1]],

            ['-timepp-axes-color']       : ['white'   , [1, 1, 1, 1]],
            ['-timepp-y-label-color']    : ['white'   , [1, 1, 1, 1]],
            ['-timepp-x-label-color']    : ['white'   , [1, 1, 1, 1]],
            ['-timepp-rulers-color']     : ['white'   , [1, 1, 1, 1]],
            ['-timepp-proj-vbar-color']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-task-vbar-color']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-vbar-bg-color']    : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-A']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-B']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-C']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-D']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-E']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-color-F']  : ['white'   , [1, 1, 1, 1]],
            ['-timepp-heatmap-selected-color'] : ['white', [1, 1, 1, 1]],
        };


        {
            let GioSSS = Gio.SettingsSchemaSource;
            let schema = GioSSS.new_from_directory(
                ME.path + '/data/schemas', GioSSS.get_default(), false);
            schema = schema.lookup('org.gnome.shell.extensions.timepp', false);

            this.settings = new Gio.Settings({ settings_schema: schema });
        }


        // @key: string (a section name)
        // @val: object (an instantiated main section object)
        //
        // This map only holds sections that are currently enabled.
        this.sections = new Map();

        // @key: string (a section name)
        // @val: object (a PopupSeparatorMenuItem().actor)
        this.separators = new Map();


        this.sigm                = new SIG_MANAGER.SignalManager();
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
        // unicon panel item (shown when single panel item mode is selected)
        //
        this.unicon_panel_item = new PANEL_ITEM.PanelItem(this.menu);
        this.unicon_panel_item.icon.gicon = MISC_UTILS.getIcon('timepp-unicon-symbolic');

        this.unicon_panel_item.set_mode('icon');
        this.unicon_panel_item.actor.add_style_class_name('unicon-panel-item');

        if (! this.settings.get_boolean('unicon-mode')) this.unicon_panel_item.actor.hide();

        this.panel_item_box.add_child(this.unicon_panel_item.actor);

        //
        // popup menu
        //
        this.box_content = new St.BoxLayout({ style_class: 'timepp-content-box', vertical: true});
        this.menu.box.add_child(this.box_content);
        this.box_content._delegate = this;


        //
        // context menu
        //
        this.context_menu = new ContextMenu.ContextMenu(this);
        this.box_content.add_actor(this.context_menu.actor);
        this.context_menu.actor.hide();


        //
        // more init
        //
        this._sync_sections_with_settings();
        this.update_panel_items();
        Mainloop.idle_add(() => this._load_stylesheet());


        //
        // listen
        //
        this.sigm.connect(St.ThemeContext.get_for_stage(global.stage), 'changed', () => {
            if (this.theme_change_signal_block) return;
            this._on_theme_changed();
        });
        this.sigm.connect(this.settings, 'changed::panel-item-position', () => {
            let new_val = this.settings.get_enum('panel-item-position');
            this._on_panel_position_changed(this.panel_item_position, new_val);
            this.panel_item_position = new_val;
        });
        this.sigm.connect(this.settings, 'changed::sections', () => this._sync_sections_with_settings());
        this.sigm.connect(this.settings, 'changed::unicon-mode', () => this.update_panel_items());
        this.sigm.connect(this.panel_item_box, 'style-changed', () => this._update_custom_css());
        this.sigm.connect(this.menu, 'open-state-changed', (_, state) => this._on_open_state_changed(state));
        this.sigm.connect(this.unicon_panel_item, 'left-click', () => this.toggle_menu());
        this.sigm.connect(this.unicon_panel_item, 'right-click', () => this.toggle_context_menu());
        this.sigm.connect(this.unicon_panel_item.actor, 'enter-event', () => { if (Main.panel.menuManager.activeMenu) this.open_menu(); });
        this.sigm.connect(this.unicon_panel_item.actor, 'key-focus-in', () => this.open_menu());
    }

    _sync_sections_with_settings () {
        let sections = this.settings.get_value('sections').deep_unpack();

        for (let key in sections) {
            if (! sections.hasOwnProperty(key)) continue;

            if (sections[key].enabled) {
                if (! this.sections.has(key)) {
                    let module = SECTIONS.get(key);
                    let section = new module.SectionMain(key, this, this.settings);

                    this.sections.set(key, section);
                    section.actor.hide();
                    this.box_content.add_child(section.actor);

                    this.panel_item_box.add_child(section.panel_item.actor);

                    let sep = new PopupMenu.PopupSeparatorMenuItem();
                    sep.actor.add_style_class_name('timepp-separator');
                    this.box_content.add_child(sep.actor);
                    this.separators.set(key, sep.actor);
                }
            } else if (this.sections.has(key)) {
                let s = this.sections.get(key);

                // The current sourceActor could be the panel_item of the section
                // we are about to disable which destroys panel_item.
                if (s.panel_item.actor === this.menu.sourceActor)
                    this._update_menu_arrow(this.actor);

                s.disable_section();
                this.sections.delete(key);
                this.separators.get(key).destroy();
                this.separators.delete(key);
            }
        }

        this.update_panel_items();
    }

    toggle_menu (section_name) {
        if (this.menu.isOpen) this.menu.close(false);
        else                  this.open_menu(section_name);
    }

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
    open_menu (section_name) {
        let section = this.sections.get(section_name);

        if (this.menu.isOpen && section && section.actor.visible) return;
        if (this.context_menu.actor.visible) return;

        this.unicon_panel_item.actor.remove_style_pseudo_class('checked');
        this.unicon_panel_item.actor.remove_style_pseudo_class('focus');
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
            } else {
                this._update_menu_arrow(section.panel_item.actor);
            }

            for (let [, section] of this.sections) {
                if (section.separate_menu) {
                    if (section.actor.visible) {
                        hidden_sections.push(section);
                        section.actor.hide();
                    }
                } else if (! section.actor.visible) {
                    shown_sections.push(section);
                    section.actor.visible = true;
                }
            }
        } else if (section.separate_menu) {
            this._update_menu_arrow(section.panel_item.actor);

            if (! section.actor.visible) {
                shown_sections.push(section);
                section.actor.visible = true;
            }

            for (let [, section] of this.sections) {
                if (section_name === section.section_name ||
                    !section.actor.visible) continue;

                hidden_sections.push(section);
                section.actor.visible = false;
            }
        }

        this._update_menu_min_size();
        this._update_separators();
        this.menu.open();

        for (let s of shown_sections)  s.on_section_open_state_changed(true);
        for (let s of hidden_sections) s.on_section_open_state_changed(false);
    }

    toggle_context_menu (section_name) {
        if (this.menu.isOpen) {
            this.menu.close(false);
            return;
        }

        let section = this.sections.get(section_name);

        if (section) this._update_menu_arrow(section.panel_item.actor);
        else         this._update_menu_arrow(this.unicon_panel_item.actor);

        this.context_menu.actor.visible = true;
        this.unicon_panel_item.actor.add_style_pseudo_class('checked');
        this.unicon_panel_item.actor.can_focus = false;

        for (let [, section] of this.sections) {
            if (section.panel_item.actor.visible) {
                section.panel_item.actor.add_style_pseudo_class('checked');
                section.panel_item.actor.can_focus = false;
            }
        }

        this._update_menu_min_size();
        this._update_separators();
        this.menu.open();
    }

    // PanelMenu only updates the min-height, we also need to update min-width.
    _update_menu_min_size () {
        let work_area    = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.findIndexForActor(this.menu.actor));
        let monitor      = Main.layoutManager.findMonitorForActor(this.menu.actor);
        let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        // @HACK
        // Some extensions enable autohiding of the panel and as a result the
        // height of the panel is not taken into account when computing the
        // work area. This is just a simple work around.
        let tweak = 16;
        if (monitor.height === work_area.height)
            tweak = Main.layoutManager.panelBox.height + tweak;

        let max_h = Math.floor((work_area.height - tweak) / scale_factor);
        let max_w = Math.floor((work_area.width  - 16) / scale_factor);

        this.menu_max_w = max_w;
        this.menu_max_h = max_h;

        this.menu.actor.style = `max-height: ${max_h}px; max-width: ${max_w}px;`;
    }

    _update_menu_arrow (source_actor) {
        this.menu._boxPointer.setPosition(source_actor, this.menu._arrowAlignment);
        this.menu.sourceActor = source_actor;
    }

    _update_separators () {
        let last_visible;

        for (let [k, sep] of this.separators) {
            if (this.sections.get(k).actor.visible) {
                last_visible = sep;
                sep.show();
            } else {
                sep.hide();
            }
        }

        if (last_visible) last_visible.hide();
    }

    _update_custom_css () {
        let update_needed = false;
        let theme_node    = this.panel_item_box.get_theme_node();

        for (let prop in this.custom_css) {
            if (! this.custom_css.hasOwnProperty(prop)) continue;

            let [success, col] = theme_node.lookup_color(prop, false);
            let hex            = col.to_string();

            if (success && this.custom_css[prop][0] !== hex) {
                update_needed = true;

                this.custom_css[prop] = [hex, [
                    col.red   / 255,
                    col.green / 255,
                    col.blue  / 255,
                    col.alpha / 255,
                ]];
            }
        }

        if (update_needed) this.emit('custom-css-changed');
    }

    update_panel_items () {
        if (this.settings.get_boolean('unicon-mode')) {
            let show_unicon = false;

            for (let [, section] of this.sections) {
                if (section.separate_menu) {
                    section.panel_item.actor.show();
                } else {
                    section.panel_item.actor.hide();
                    show_unicon = true;
                }
            }

            this.unicon_panel_item.actor.visible = show_unicon;
        } else {
            this.unicon_panel_item.actor.hide();

            for (let [, section] of this.sections) {
                section.panel_item.actor.visible = true;
            }
        }
    }

    _on_panel_position_changed (old_pos, new_pos) {
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
    }

    _on_open_state_changed (state) {
        if (state) return Clutter.EVENT_PROPAGATE;

        this.context_menu.actor.hide();
        this.unicon_panel_item.actor.remove_style_pseudo_class('checked');
        this.unicon_panel_item.actor.remove_style_pseudo_class('focus');
        this.unicon_panel_item.actor.can_focus = true;

        for (let [, section] of this.sections) {
            section.panel_item.actor.remove_style_pseudo_class('checked');
            section.panel_item.actor.remove_style_pseudo_class('focus');
            section.panel_item.actor.can_focus = true;

            if (section.actor.visible) {
                section.on_section_open_state_changed(false);
                section.actor.visible = false;
            }
        }
    }

    _on_theme_changed () {
        if (this.custom_stylesheet) this._unload_stylesheet();
        this._load_stylesheet();
    }

    _load_stylesheet () {
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

        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this.custom_stylesheet);

        // reload theme
        Main.reloadThemeResource();
        Main.loadTheme();

        Mainloop.idle_add(() => this.theme_change_signal_block = false);
    }

    _unload_stylesheet () {
        if (! this.custom_stylesheet) return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this.custom_stylesheet);
        this.custom_stylesheet = null;
    }

    is_section_enabled (section_name) {
        return this.sections.has(section_name);
    }

    // Used by sections to communicate with each other.
    // This way any section can listen for signals on the main ext object.
    emit_to_sections (sig, section_name, data) {
        this.emit(sig, section_name, data);
    }

    // ScrollView always allocates horizontal space for the scrollbar when the
    // policy is set to AUTOMATIC. The result is an ugly padding on the right
    // when the scrollbar is invisible.
    needs_scrollbar () {
        let [, nat_h] = this.menu.actor.get_preferred_height(-1);
        let max_h     = this.menu.actor.get_theme_node().get_max_height();

        return max_h >= 0 && nat_h >= max_h;
    }

    destroy () {
        // We need to make sure that this one is set to the default actor or
        // else the shell will try to destroy the wrong panel actor.
        this._update_menu_arrow(this.actor);

        for (let [, section] of this.sections) section.disable_section();

        this.sections.clear();
        this.separators.clear();

        this._unload_stylesheet();
        this.sigm.clear();

        super.destroy();
    }
})


// =====================================================================
// @@@ Init
// =====================================================================
function init () {}

let timepp;

function enable () {
    timepp = new Timepp();

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
