const St   = imports.gi.St;
const Main = imports.ui.main;
const Lang = imports.lang;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const PANEL_ITEM = ME.imports.lib.panel_item;



// =====================================================================
// @@@ SectionBase
//
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
//
// @signals:
//     - 'section-open-state-changed' (return bool (state))
// =====================================================================
var SectionBase = new Lang.Class({
    Name: 'Timepp.SectionBase',

    _init: function (section_name, ext, settings) {
        this.section_name = section_name;
        this.ext          = ext;
        this.settings     = settings;

        this.separate_menu = false;

        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);
        this.actor      = new St.BoxLayout({ x_expand: true, y_expand: true, vertical: true, style_class: 'section' });


        //
        // listen
        //
        this.panel_item.connect('right-click', () => this.ext.toggle_context_menu(this.section_name));
        this.panel_item.actor.connect('enter-event', () => { if (Main.panel.menuManager.activeMenu) this.ext.open_menu(this.section_name)});
        this.panel_item.actor.connect('key-focus-in', () => this.ext.open_menu(this.section_name));
    },

    disable_section: function () {
        this.panel_item.actor.destroy();
        this.actor.destroy();
    },

    on_section_open_state_changed: function (state) {
        if (state) {
            this.panel_item.actor.add_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = false;
        } else {
            this.panel_item.actor.remove_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = true;
            this.panel_item.actor.remove_style_pseudo_class('focus');
        }

        this.emit('section-open-state-changed', state);
    },
});
