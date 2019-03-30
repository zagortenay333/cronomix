const Gio     = imports.gi.Gio
const GLib    = imports.gi.GLib;
const Shell   = imports.gi.Shell;
const Config  = imports.misc.config;
const Clutter = imports.gi.Clutter;
const Main    = imports.ui.main


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


var global_wrapper; // Some backwards compatibility...
if (Config.PACKAGE_VERSION < '3.29') {
    global_wrapper = {
        display           : global.screen,
        workspace_manager : global.screen,
    };
} else {
    global_wrapper = {
        display           : global.display,
        workspace_manager : global.workspace_manager,
    };
}


// @path: string (uri)
function open_web_uri (uri) {
    uri = uri.trim();
    if (uri.indexOf(':') === -1) uri = 'https://' + uri;

    try {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) { logError(e); }
}


// @path: string
function open_file_path (path) {
    path = path.replace(/\\ /g, ' ').trim();
    if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);

    try {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            Gio.app_info_launch_default_for_uri(GLib.filename_to_uri(path, null),
                                                global.create_app_launch_context(0, -1));
        } else { Main.notify(_('File or dir not found.')); }
    } catch (e) { logError(e); }
}


// @path: string
//
// @return: GFile or null
function file_new_for_path (path) {
    if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);

    try {
        let d = Gio.file_new_for_path(path);
        return d;
    } catch (e) {
        logError(e);
        return null;
    }
}


// @select_dirs : bool
// @callback    : func (string)
//
// @return      : Gio.Subprocess or null
function open_file_dialog (select_dirs, callback) {
    let argv = ["zenity", "--file-selection", (select_dirs ? "--directory" : "")];
    let sp   = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);

    sp.wait_check_async(null, (_, res) => {
        try {
            sp.wait_check_finish(res);
        } catch (e) { return null; }

        let stream = Gio.DataInputStream.new(sp.get_stdout_pipe());
        let [out,] = stream.read_line_utf8(null);
        callback(out);
        stream.close(null);
    });

    return sp;
}


// @gfile    : GFile
// @callback : function
//
// @return   : [GFileMonitor, signal_id] or null
function file_monitor (gfile, callback) {
    try {
        let monitor    = gfile.monitor(Gio.FileMonitorFlags.NONE, null);
        let monitor_id = monitor.connect('changed', (...args) => {
            let e = args[3];
            if (e !== Gio.FileMonitorEvent.CHANGED && e !== Gio.FileMonitorEvent.CREATED)
                callback();
        });
        return [monitor, monitor_id];
    } catch (e) {
        logError(e);
        return null;
    }
}


function maybe_ignore_release (actor) {
    let [x, y, mask] = global.get_pointer();
    let a            = Shell.util_get_transformed_allocation(actor);

    if (! (x > a.x1 && x < a.x2 && y > a.y1 && y < a.y2))
        Main.panel.menuManager.ignoreRelease();
}


// return date string in yyyy-mm-dd format adhering to locale
function date_yyyymmdd (date_obj) {
    let now = date_obj || new Date();

    let month = now.getMonth() + 1;
    let day   = now.getDate();

    month = (month < 10) ? ('-' + 0 + month) : ('-' + month);
    day   = (day   < 10) ? ('-' + 0 + day)   : ('-' + day);

    return now.getFullYear() + month + day;
}

function date_delta (date) {
    let diff = Math.round(
        (Date.parse(date + 'T00:00:00') -
         Date.parse(date_yyyymmdd() + 'T00:00:00'))
        / 86400000);
    return(diff);
}

function date_delta_str (date) {
    let diff = date_delta(date);
    let abs = Math.abs(diff);

    let res;

    if (diff === 0)    res = _('today');
    else if (diff < 0) res = ngettext('%d day ago', '%d days ago', abs).format(abs);
    else               res = ngettext('in %d day', 'in %d days', abs).format(abs);

    return res.replace(/ /g, '&#160;'); // non-breaking-space
}


// @str: string
//
// Splits string into array tokens.
//
// - All chars from @str are kept in the array.
// - Whitespace between tokens is kept as a separate item in the array.
// - Whitespace can be kept inside a token by escaping it with a backlash '\'.
//
// Example output: ["as\ df", "   ", "asdf", "\n  ", "qwert\ y", "  "]
//
// The main two purposes of this function are that it allows tokens to have
// escaped spaces (file path keywords with spaces), and that because it doesn't
// remove any chars in the resulting array it makes the text highlighting algo
// simple.
function split_on_whitespace (str) {
    let words = [];
    let word  = '';

    if (! str) return word;

    for (let i = 0, len = str.length; i < len; i++) {
        if (str[i] === '\\') {
            word += '\\';

            if (i !== len) {
                i++;
                word += str[i];
            }
        } else if (/\s/.test(str[i])) {
            if (word) words.push(word);
            word = str[i];

            while (++i < len && /\s/.test(str[i])) {
                word += str[i];
            } i--;

            words.push(word);
            word = '';
        } else {
            word += str[i];
        }
    }

    if (word) words.push(word);

    return words;
}


// @label: St.Label
//
// @BUG
// There is an issue with resizing when using pango's wrap mode together with a
// scrollview. The label does not seem to get resized properly and as a result
// to container doesn't either, which leads to various issues.
function resize_label (label) {
    let theme_node         = label.get_theme_node();
    let a                  = label.get_allocation_box();
    let [min_h, nat_h]     = label.clutter_text.get_preferred_height(theme_node.adjust_for_width(a.x2 - a.x1));
    let [, nat_h_adjusted] = theme_node.adjust_preferred_height(min_h, nat_h);

    label.set_height(nat_h + nat_h_adjusted - nat_h);
}


// @scrollview  : St.ScrollView
// @scrollbox   : St.ScrollBox (direct child of @scrollview)
// @item        : a descendant of @scrollbox
// @item_parent : parent of @item (by default it's assumed to be @scrollbox)
// @horizontal  : bool
function scroll_to_item (scrollview, scrollbox, item, item_parent = scrollbox, horizontal = false) {
    let padding = 0;

    // Compute the padding of the @scrollview.
    {
        let n = scrollview.get_theme_node();
        let a = scrollview.get_allocation_box();

        if (horizontal) {
            let h                  = n.adjust_for_height(a.y2 - a.y1);
            let [min_w, nat_w]     = scrollview.get_preferred_width(h);
            let [, nat_w_adjusted] = n.adjust_preferred_width(min_w, nat_w);
            padding               += nat_w_adjusted - nat_w;
        } else {
            let w                  = n.adjust_for_width(a.x2 - a.x1);
            let [min_h, nat_h]     = scrollview.get_preferred_height(w);
            let [, nat_h_adjusted] = n.adjust_preferred_height(min_h, nat_h);
            padding               += nat_h_adjusted - nat_h;
        }
    }

    // Update padding taking the @scrollbox into account.
    {
        let n = scrollbox.get_theme_node();
        let a = scrollbox.get_allocation_box();

        if (horizontal) {
            let h                  = n.adjust_for_height(a.y2 - a.y1);
            let [min_w, nat_w]     = scrollbox.get_preferred_width(h);
            let [, nat_w_adjusted] = n.adjust_preferred_width(min_w, nat_w);
            padding               += nat_w_adjusted - nat_w;
        } else {
            let w                  = n.adjust_for_width(a.x2 - a.x1);
            let [min_h, nat_h]     = scrollbox.get_preferred_height(w);
            let [, nat_h_adjusted] = n.adjust_preferred_height(min_h, nat_h);
            padding               += nat_h_adjusted - nat_h;
        }
    }

    // Do the scroll.
    {
        let bar;
        let current_scroll_value;
        let new_scroll_value;
        let adjust;
        let box;

        if (horizontal) {
            bar = scrollview.get_hscroll_bar();
            if (! bar) return;

            adjust               = bar.get_adjustment();
            current_scroll_value = adjust.get_value();
            new_scroll_value     = current_scroll_value;

            let a = scrollview.get_allocation_box();
            box   = a.x2 - a.x1;
        } else {
            bar = scrollview.get_vscroll_bar();
            if (! bar) return;

            adjust               = bar.get_adjustment();
            current_scroll_value = adjust.get_value();
            new_scroll_value     = current_scroll_value;

            let a = scrollview.get_allocation_box();
            box   = a.y2 - a.y1;
        }

        let low;
        let high;

        {
            let a = item.get_allocation_box();

            // The function get_allocation_vertices() is unfortunately not
            // introspectible, which would make this a little more elegant...
            let p1 = item_parent.apply_relative_transform_to_point(scrollbox, Clutter.Vertex.new(a.x1, a.y1, 0));
            let p2 = item_parent.apply_relative_transform_to_point(scrollbox, Clutter.Vertex.new(a.x2, a.y2, 0));

            if (horizontal) {
                low  = p1.x - padding;
                high = p2.x + padding - box;

            } else {
                low  = p1.y - padding;
                high = p2.y + padding - box;
            }
        }

        if      (current_scroll_value > low)  new_scroll_value = low;
        else if (current_scroll_value < high) new_scroll_value = high;

        if (new_scroll_value !== current_scroll_value) adjust.set_value(new_scroll_value);
    }
}


// @string       : string
// @markdown_map : Map
//     @key: string (a markup delim)
//     @val: array  [string (opening pango tags), string (closing pango tags)]
//           or null to not use a single char delim
//
// A simple markdown implementation.
//
// This function will look for delim pairs and replace them with the open/close
// tags provided in @markdown_map.
//
// The delim '`' (backtick) is treated specially.
// Any delims inside a pair of '`', or '``', or '```', etc, will be ignored.
// A '`' appearing inside a '``' will also be ignored.
//
// @NOTE:
// To prevent interleaved html tags, make sure to wrap each already wrapped text
// into a pair of backticks!
//
// A delim is a single char, but if a particular delim is in the @markdown_map,
// then the @markdown_map can have additional delim strings consisting entirely of
// one type of delim. E.g., if the char '#' is a delim, then '##' can also be a
// delim, as well as '###', '#####', etc...
//
// Example @markdown_map:
//     new Map([
//         ['`'   , ['<tt><span background="lightgrey">', '</span></tt>']],
//         ['``'  , ['<tt><span background="lightgrey">', '</span></tt>']],
//         ['```' , ['<tt>', '</tt>']],
//
//         ['*'   , ['<b>', '</b>']],
//         ['**'  , ['<i>', '</i>']],
//         ['***' , ['<b><span background="tomato">', '</span></b>']],
//
//         ['_'   , ['<i>', '</i>']],
//         ['__'  , ['<u>', '</u>']],
//         ['___' , ['<s>', '</s>']],
//
//         ['$'   , ['<span size="xx-large">', '</span>']],
//     ]);
function markdown_to_pango (string, markdown_map) {
    let backslash = false;
    let delims    = [];

    // The func works as follows:
    // We loop over the string and look for delims as defined in @markdown_map.
    // Whenever we come across a delim string:
    //     - We make a delim_tuple.
    //     - We look to see whether there is already a delim tuple in delims.
    //     - We balance both delim tuples by adding refs to each other.
    // Whenever we balance a pair of delims we make sure that the delims found
    // between them are nulled from the delims array. (more details below.)
    // Once the delims array is established, we make a new string.
    for (let i = 0, string_l = string.length; i < string_l; i++) {
        let delim = string[i];

        if (delim === '\\') {
            backslash = true;
            continue;
        } else if (backslash) {
            backslash = false;
            continue;
        } else if (! markdown_map.has(delim)) {
            continue;
        }

        // [delim, matching delim_tuple, pango_markup, delim.length, pos_in_text]
        let delim_tuple = [delim, null, '', 0, i];

        // check for multi-char delim
        while (++i < string_l && string[i] === delim) {
            delim_tuple[0] += delim;
        } i--;

        delim = delim_tuple[0];

        if (! markdown_map.get(delim)) {
            continue;
        }

        delim_tuple[3] = delim.length;

        // loop backwards to try and find an identical delim
        let l = delims.length;
        while (l--) if (delims[l] && delims[l][0] === delim) break;

        if (l >= 0 && !delims[l][1]) { // identical delim found and is unbalanced
            delims[l][1]   = delim_tuple;
            delim_tuple[1] = delims[l];
            delim_tuple[2] = markdown_map.get(delim)[1];

            if (delim[0] === '`') {
                // If we are closing a backtick, we null all delims between them.
                // If a delim inside the backticks was already balanced, we will
                // null it and make it's pair unbalanced again.
                for (l++; l < delims.length; l++) {
                    if (delims[l]) {
                        if (delims[l][1]) delims[l][1][1] = null;
                        delims[l] = null;
                    }
                }
            } else {
                // If we are closing non-backticks, we make sure to null all
                // delims between them that are not balanced except backticks.
                for (l++; l < delims.length; l++) {
                    if (delims[l] && delims[l][0][0] !== '`' && !delims[l][1])
                        delims[l] = null;
                }
            }
        } else {
            delim_tuple[2] = markdown_map.get(delim)[0];
        }

        delims.push(delim_tuple);
    }

    if (delims.length === 0) return string;

    let res = '';
    let i   = 0;

    for (let delim of delims) {
        if (!delim || !delim[1]) continue;

        for (; i < delim[4]; i++) res += string[i];

        res += delim[2];
        i   += delim[3];
    }

    for (; i < string.length; i++) res += string[i];

    return res;
}

function getIcon(name){
    return Gio.icon_new_for_string(ME.path + '/data/img/icons/' + name + ".svg");
}
