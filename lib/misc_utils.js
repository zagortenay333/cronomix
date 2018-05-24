const GLib    = imports.gi.GLib;
const Gio     = imports.gi.Gio
const Clutter = imports.gi.Clutter;
const Main    = imports.ui.main


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


// @path: string (uri)
function open_web_uri (uri) {
    if (uri.indexOf(':') === -1) uri = 'https://' + uri;

    try {
        Gio.app_info_launch_default_for_uri(uri,
            global.create_app_launch_context(0, -1));
    }
    catch (e) { logError(e); }
}


// @path: string
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
        } catch (e) { logError(e); }
    } else {
        Main.notify(_('File or dir not found.'));
    }
}


// @path: string
function file_new_for_path (path) {
    if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);

    try {
        let d = Gio.file_new_for_path(path);
        return d;
    } catch (e) { return null; }
}


// @select_dirs : bool
// @callback    : func (string)
// returns      : Gio.Subprocess or null
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


// Ignore the mouse release if the primary mouse btn is pressed and the pointer
// is outside of actor.
function maybe_ignore_release (actor) {
    let [x, y, mask] = global.get_pointer();

    if (mask & Clutter.ModifierType.BUTTON1_MASK) {
        let a      = actor.get_allocation_box();
        [, x, y]   = actor.transform_stage_point(x, y);

        if (! (x > a.x1 && x < a.x2 && y > a.y1 && y < a.y2)) {
            Main.panel.menuManager.ignoreRelease();
        }
    }
}


// @str: string
//
// This function splits the @str into words at whitespace and returns and
// array of those words.
//
// - Non-escaped whitespace will be removed except end-of-line.
// - Newline chars are kept as separate words, which makes it possible to
//   join the words back into a correct string. (But beware possible spaces that
//   get appended around the newline char when joining the words.)
// - Whitespace can be included by escaping it with a backlash ('\').
//
// Example: ['as\ df', '\n', '\n', 'qwert\ y', ...].
function split_on_whitespace (str) {
    let words = [];
    let word  = '';

    if (! str) return word;

    for (let i = 0, len = str.length; i < len; i++) {
        if (str[i] === '\n' || str[i] === '\r') {
            if (word) {
                words.push(word);
                word = '';
            }

            words.push('\n');
        }
        else if (str[i] === '\\') {
            word += '\\';

            if (i !== len) {
                i++;
                word += str[i];
            }
        }
        else if (/\s/.test(str[i])) {
            if (word) {
                words.push(word);
                word = '';
            } else {
                word += str[i];
            }
        }
        else {
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
// to container doesn't either, which leads various issues.
//
// The needs_scrollbar func will not return a correct value because of this.
// Also, sometimes the bottom actor might be cut off, or extra padding might be
// added...
//
// The issue does not appear if the scrollbar is visible, so it doesn't need to
// be used all the time and is not a performance issue.
//
// This func needs to be used at a time when the actor is already drawn, or it
// will not work.
function resize_label (label) {
    let theme_node = label.get_theme_node();
    let alloc_box  = label.get_allocation_box();

    // gets the acutal width of the box
    let w = alloc_box.x2 - alloc_box.x1;

    // remove paddings and borders
    w = theme_node.adjust_for_width(w);

    // nat_height is the minimum height needed to fit the multiline text
    // **excluding** the vertical paddings/borders.
    let [min_h, nat_h] = label.clutter_text.get_preferred_height(w);

    // The vertical padding can only be calculated once the box is painted.
    // nat_height_adjusted is the minimum height needed to fit the multiline
    // text **including** vertical padding/borders.
    let [min_h_adjusted, nat_h_adjusted] =
        theme_node.adjust_preferred_height(min_h, nat_h);

    let vert_padding = nat_h_adjusted - nat_h;

    label.set_height(nat_h + vert_padding);
}

// @scrollview  : St.ScrollView
// @scrollbox   : St.ScrollBox (direct child of @scrollview)
// @item        : a descendant of @scrollbox
// @item_parent : parent of @item (by default it's assumed to be @scrollbox)
function scroll_to_item (scrollview, scrollbox, item, item_parent = scrollbox) {
    let padding = 0;

    // Compute the vertical padding of the scrollbox.
    {
        let outer_theme_node = scrollview.get_theme_node();
        let alloc            = scrollview.get_allocation_box();
        let outer_w = outer_theme_node.adjust_for_width(alloc.x2 - alloc.x1);

        let [min_outer_h, nat_outer_h] =
            scrollview.get_preferred_height(outer_w);

        let [, nat_outer_h_adjusted] =
            outer_theme_node.adjust_preferred_height(min_outer_h, nat_outer_h);

        padding += nat_outer_h_adjusted - nat_outer_h;
    }

    // Update padding taking the inner_box into account.
    {
        let inner_theme_node = scrollbox.get_theme_node();
        let alloc            = scrollbox.get_allocation_box();
        let inner_w = inner_theme_node.adjust_for_width(alloc.x2 - alloc.x1);

        let [min_inner_h, nat_inner_h] =
            scrollbox.get_preferred_height(inner_w);

        let [, nat_inner_h_adjusted] =
            inner_theme_node.adjust_preferred_height(min_inner_h, nat_inner_h);

        padding += Math.round((nat_inner_h_adjusted - nat_inner_h) / 2);
    }

    // Do the scroll.
    {
        let vscroll_bar = scrollview.get_vscroll_bar();

        if (! vscroll_bar) return;

        let current_scroll_value = vscroll_bar.get_adjustment().get_value();

        let new_scroll_value = current_scroll_value;
        let alloc            = scrollview.get_allocation_box();
        let box_h            = alloc.y2 - alloc.y1;

        let item_y1;

        // The function get_allocation_vertices() is unfortunately not
        // introspectible, which would make this a little more elegant...
        {
            let a = item.get_allocation_box();
            let p = item_parent.apply_relative_transform_to_point(
                scrollbox, Clutter.Vertex.new(a.x1, a.y1, 0));
            item_y1 = p.y;
        }

        if (current_scroll_value > item_y1 - padding)
            new_scroll_value = item_y1 - padding;

        let item_y2;

        {
            let a = item.get_allocation_box();
            let p = item_parent.apply_relative_transform_to_point(
                scrollbox, Clutter.Vertex.new(a.x2, a.y2, 0));
            item_y2 = p.y;
        }

        if (box_h + current_scroll_value < item_y2 + padding)
            new_scroll_value = item_y2 - box_h + padding;

        if (new_scroll_value !== current_scroll_value)
            vscroll_bar.get_adjustment().set_value(new_scroll_value);
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
                    if (delims[l][1]) delims[l][1][1] = null;
                    delims[l] = null;
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
