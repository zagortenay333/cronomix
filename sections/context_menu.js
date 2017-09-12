const St        = imports.gi.St;
const Gio       = imports.gi.Gio
const Shell     = imports.gi.Shell;
const PopupMenu = imports.ui.popupMenu;
const Util      = imports.misc.util;
const Lang      = imports.lang;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


// =====================================================================
// @@@ Context Menu
//
// @ext: obj (main extension object)
// =====================================================================
var ContextMenu = new Lang.Class({
    Name: 'Timepp.ContextMenu',

    _init: function (ext) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section context-menu-section', x_expand: true });


        //
        // items
        //
        this.settings_link = new MenuItem('timepp-wrench-symbolic', _('Open settings'));
        this.actor.add_actor(this.settings_link.actor);

        this.website_link = new MenuItem('timepp-link-symbolic', _('Go to extension website'));
        this.actor.add_actor(this.website_link.actor);

        this.report_bug_link = new MenuItem('timepp-issue-symbolic', _('Report bug'));
        this.actor.add_actor(this.report_bug_link.actor);

        this.translations_link = new MenuItem('timepp-translate-symbolic', _('Help with translations'));
        this.actor.add_actor(this.translations_link.actor);


        //
        // listen
        //
        this.settings_link.connect('activate', () => {
            Util.spawn(["gnome-shell-extension-prefs", ME.metadata.uuid]);
            ext.toggle_context_menu();
        });
        this.website_link.connect('activate', () => {
            try {
                Gio.app_info_launch_default_for_uri(
                    ME.metadata.url,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e); }
            ext.toggle_context_menu();
        });
        this.report_bug_link.connect('activate', () => {
            try {
                Gio.app_info_launch_default_for_uri(
                    ME.metadata.issues_url,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e); }
            ext.toggle_context_menu();
        });
        this.translations_link.connect('activate', () => {
            try {
                Gio.app_info_launch_default_for_uri(
                    ME.metadata.translations_url,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e); }
            ext.toggle_context_menu();
        });
    },
});


// =====================================================================
// @@@ The popupmenuitem with icons on the left side
//
// @icon_name : string
// @label     : string
// =====================================================================
const MenuItem = new Lang.Class({
    Name    : 'Timepp.PopupMenuIconItem',
    Extends : PopupMenu.PopupBaseMenuItem,

    _init: function (icon_name, label, params) {
        this.parent(params);

        this.icon = new St.Icon({ icon_name: icon_name });
        this.actor.add_child(this.icon);

        this.label = new St.Label({ text: label });
        this.actor.add_child(this.label);
    },
});
