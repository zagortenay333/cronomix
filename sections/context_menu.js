const St        = imports.gi.St;
const Gio       = imports.gi.Gio
const GObject   = imports.gi.GObject
const PopupMenu = imports.ui.popupMenu;
const Util      = imports.misc.util;



const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MISC_UTILS = ME.imports.lib.misc_utils;



// =====================================================================
// @@@ ContextMenu
//
// @ext: obj (main extension object)
// =====================================================================
var ContextMenu = class ContextMenu {
    constructor (ext) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section context-menu-section', x_expand: true });


        //
        // items
        //
        this.settings_link = new PopupMenuIconItem('timepp-wrench-symbolic', _('Open settings'));
        this.actor.add_actor(this.settings_link.actor);

        this.website_link = new PopupMenuIconItem('timepp-link-symbolic', _('Go to extension website'));
        this.actor.add_actor(this.website_link.actor);

        this.report_bug_link = new PopupMenuIconItem('timepp-issue-symbolic', _('Report bug'));
        this.actor.add_actor(this.report_bug_link.actor);

        this.translations_link = new PopupMenuIconItem('timepp-translate-symbolic', _('Help with translations'));
        this.actor.add_actor(this.translations_link.actor);


        //
        // listen
        //
        this.settings_link.connect('activate', () => {
            Util.spawn(["gnome-shell-extension-prefs", ME.metadata.uuid]);
            ext.toggle_context_menu();
        });
        this.website_link.connect('activate', () => {
            MISC_UTILS.open_web_uri(ME.metadata.url);
            ext.toggle_context_menu();
        });
        this.report_bug_link.connect('activate', () => {
            MISC_UTILS.open_web_uri(ME.metadata.issues_url);
            ext.toggle_context_menu();
        });
        this.translations_link.connect('activate', () => {
            MISC_UTILS.open_web_uri(ME.metadata.translations_url);
            ext.toggle_context_menu();
        });
    }
}


// =====================================================================
// @@@ PopupMenuIconItem
//
// @icon_name : string
// @label     : string
// =====================================================================
var PopupMenuIconItem = GObject.registerClass({
    GTypeName: 'PopupMenuIconItem'
}, class PopupMenuIconItem extends PopupMenu.PopupBaseMenuItem {
    _init (icon_name, label, params) {
        super._init(params);

        this.icon = new St.Icon({ gicon: MISC_UTILS.getIcon(icon_name) });
        this.add_child(this.icon);

        this.label = new St.Label({ text: label });
        this.add_child(this.label);
    }
})
