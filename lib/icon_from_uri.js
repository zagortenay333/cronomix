const St   = imports.gi.St;
const Gtk  = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Gio  = imports.gi.Gio


/*
 * @icon:      An St.Icon
 * @icon_path: Either an absolute path to an svg, a path relative to this
 *             applet's dir (e.g., /icons/timer-symbolic.svg), or just an icon
 *             name
 * @path:  extension dir path
 *
 * The function will set the @icon's icon to @icon_path.
 */
function icon_from_uri (icon, icon_path, path) {
    if (icon_path == '' ||
        (GLib.path_is_absolute(icon_path) &&
         GLib.file_test(icon_path, GLib.FileTest.IS_REGULAR))) {

        let file = Gio.file_new_for_path(icon_path);
        icon.set_gicon(new Gio.FileIcon({ file: file }));
    }
    else if ( Gtk.IconTheme.get_default().has_icon(icon_path) ) {
        icon.set_icon_name(icon_path);
    }
    else if (icon_path.search(path) === -1) {
        let new_icon_path = path + icon_path;
        icon_from_uri(icon, new_icon_path, path);
    }
    else {
        icon.set_icon_name('dialog-question-symbolic');
    }
}
