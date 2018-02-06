const Main = imports.ui.main
const GLib = imports.gi.GLib;
const Gio  = imports.gi.Gio


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;



// @path: uri
function open_web_uri (uri) {
    if (uri.indexOf(':') === -1)
        uri = 'https://' + uri;

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
        }
        catch (e) { logError(e); }
    }
    else {
        Main.notify(_('File or dir not found.'));
    }
}


// @str: string
//
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

// @scrollview : the St.ScrollView
// @scrollbox  : an St.ScrollBox (direct child of @scrollview)
// @item       : direct child of @scrollbox
function scroll (scrollview, scrollbox, item) {
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
        let item_y1          = item.get_allocation_box().y1;

        if (current_scroll_value > item_y1 - padding) {
            new_scroll_value = item_y1 - padding;
        }

        let item_y2 = item.get_allocation_box().y2;

        if (box_h + current_scroll_value < item_y2 + padding) {
            new_scroll_value = item_y2 - box_h + padding;
        }

        if (new_scroll_value !== current_scroll_value) {
            vscroll_bar.get_adjustment().set_value(new_scroll_value);
        }
    }
}
