const St             = imports.gi.St;
const Gio            = imports.gi.Gio
const Shell          = imports.gi.Shell;
const PopupMenu      = imports.ui.popupMenu;
const Util           = imports.misc.util;
const Lang           = imports.lang;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const Gettext = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const WEBSITE_LINK    = 'https://www.github.com/zagortenay333/timepp__gnome';
const REPORT_BUG_LINK = 'https://www.github.com/zagortenay333/timepp__gnome/issues';


const ContextMenu = new Lang.Class({
    Name: 'Timepp.ContextMenu',

    _init: function (ext) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section context-menu-section', x_expand: true });


        //
        // items
        //
        this.settings_link = new PopupMenu.PopupMenuItem(_('Open settings'));
        this.actor.add_actor(this.settings_link.actor);

        this.website_link = new PopupMenu.PopupMenuItem(_('Go to extension website'));
        this.actor.add_actor(this.website_link.actor);

        this.report_bug_link = new PopupMenu.PopupMenuItem(_('Report bug'));
        this.actor.add_actor(this.report_bug_link.actor);



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
                    WEBSITE_LINK,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e.message); }
            ext.toggle_context_menu();
        });
        this.report_bug_link.connect('activate', () => {
            try {
                Gio.app_info_launch_default_for_uri(
                    REPORT_BUG_LINK,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e.message); }
            ext.toggle_context_menu();
        });
    },
});
