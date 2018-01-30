const Main = imports.ui.main
const GLib = imports.gi.GLib;
const Gio  = imports.gi.Gio


function open_web_uri (uri) {
    if (uri.indexOf(':') === -1)
        uri = 'https://' + uri;

    try {
        Gio.app_info_launch_default_for_uri(uri,
            global.create_app_launch_context(0, -1));
    }
    catch (e) { logError(e); }
}

function open_file_path (path) {
    path = path.replace(/\\ /g, ' ');

    if (path[0] === '~') {
        path = GLib.get_home_dir() + path.slice(1);
    }

    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
        try {
            Gio.app_info_launch_default_for_uri(
                GLib.filename_to_uri(path, null),
                global.create_app_launch_context(0, -1));
        }
        catch (e) { logError(e); }
    }
    else {
        Main.notify(_('File or dir not found.'));
    }
}

// This function splits the @str into words at whitespace and returns and
// array of those words.
//
// - Non-escaped whitespace will be removed except (newline) \n and \r.
// - Newline chars are kept as separate words, which makes it possible to
//   join the words back into a correct string. (But beware possible spaces that
//   get appended around the newline char when joining the words.)
// - Whitespace can be included by escaping it with a backlash ('\').
//
// Example: ['as\ df', '\n', '\n', 'qwert\ y', ...].
function split_on_whitespace (str) {
    let words = [];
    let i, word;

    // We want the counter to always start from a non-zero position so that we
    // can look at the prev char, which keeps the loop simple.
    if (str.startsWith('\\ ')) {
        i    = 2;
        word = ' ';
    }
    else {
        i    = 1;
        word = (str[0] === ' ') ? '' : str[0];
    }

    for (let len = str.length; i < len; i++) {
        if (str[i] === '\n' || str[i] === '\r') {
            if (word) {
                words.push(word);
                word = '';
            }

            words.push(str[i]);
        }
        else if (/\s/.test(str[i])) {
            if (str[i - 1] === '\\') {
                word += str[i];
            }
            else if (word) {
                words.push(word);
                word = '';
            }
        }
        else {
            word += str[i];
        }
    }

    if (word) words.push(word);

    return words;
}
