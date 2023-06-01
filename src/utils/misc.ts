import * as St from 'imports.gi.St';
import * as Gio from 'imports.gi.Gio';
import * as Main from 'imports.ui.main';
import * as Meta from 'imports.gi.Meta';
import * as Clutter from 'imports.gi.Clutter';

declare const imports: any;

export type Rectangle = {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
}

type Extension = Immutable<{
    path: string,

    metadata: {
        url: string,
        name: string,
        uuid: string,
        version: number,
        description: string,
        ['shell-version']: string[],
    }
}>;

export const [shell_version] = imports.misc.config.PACKAGE_VERSION.split('.').map((x:unknown) => Number(x));
export const Me: Extension = imports.misc.extensionUtils.getCurrentExtension();
export const _: (str: string) => string = imports.gettext.domain(Me.metadata.uuid).gettext;

import * as Fs from 'utils/fs';
import { FocusTracker } from 'utils/focus';
import { scroll_to_widget } from 'utils/scroll';

export function unreachable (_: never): never {
    throw new Error('Unreachable.');
}

export function get_icon (str: string): Gio.Icon {
    return Gio.Icon.new_for_string(Me.path + '/data/icons/' + str + '.svg');
}

export function get_transformed_allocation (actor: Clutter.Actor): Rectangle {
    const extents      = actor.get_transformed_extents();
    const top_left     = extents.get_top_left();
    const bottom_right = extents.get_bottom_right();
    return { x1: top_left.x, y1: top_left.y, x2: bottom_right.x, y2: bottom_right.y };
}

export function get_monitor_work_area (for_actor: Clutter.Actor) {
    const monitor = Main.layoutManager.findIndexForActor(for_actor);
    return Main.layoutManager.getWorkAreaForMonitor(monitor);
}

// Returns the bounding box of the line that contains the idx.
//
// The box coordinates are relative to the same thing that the
// allocation box of the containing Clutter.Text are.
//
// The box extends horizontally to the edges of the Clutter.Text.
export function get_line_box_at_idx (text: Clutter.Text, idx: number): Rectangle {
    if (! text.is_mapped()) return { x1:0, x2:0, y1:0, y2:0 };

    const a = text.get_allocation_box();
    const [,, y, line_height] = text.position_to_coords(idx);

    return {
        x1: a.x1,
        x2: a.x2,
        y1: a.y1 + y,
        y2: a.y1 + y + line_height,
    };
}

export function run_before_redraw (fn: () => void) {
    if (shell_version >= '44') {
        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.BEFORE_REDRAW, () => { fn(); return false; });
    } else {
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => { fn(); return false; });
    }
}

export function run_when_mapped (actor: Clutter.Actor, fn: () => void, once = true) {
    let id1 = 0;
    let id2 = 0;
    let destroyed = false;

    const run = () => {
        if (destroyed || !actor.is_mapped()) return;
        if (once) { actor.disconnect(id1); actor.disconnect(id2); }
        fn();
    };

    id1 = actor.connect('destroy', () => destroyed = true);
    id2 = actor.connect('notify::mapped', run);

    if (actor.is_mapped()) run();
}

export function focus_when_mapped (actor: Clutter.Actor) {
    run_when_mapped(actor, () => actor.grab_key_focus());
}

// TODO(GNOME_BUG): The functions adjust_width and adjust_height
// are used to fix layout issues in the Clutter toolkit. No idea
// how/why/when they work; they're discovered by trial and error.
//
// In particular, they are applied to Clutter.GridLayout and
// popups so that St.Label's render properly inside tables
// and so that tables don't get clipped off.
//
// These are also used to implement the multiline entry widget.
//
// Also, sometimes this will not work if the container of the
// actor on which these functions are applied has a 'min-width'
// css property.
export function adjust_width (widget: St.Widget, child: Clutter.Actor = widget) {
    let destroyed = false;
    widget.connect('destroy', () => destroyed = true);

    run_before_redraw(() => {
        if (destroyed || !widget.is_mapped()) return;

        const theme_node  = widget.get_theme_node();
        const a           = widget.get_allocation_box();
        let [, nat_width] = child.get_preferred_width(-1);
        nat_width         = nat_width + theme_node.get_horizontal_padding();
        const width       = theme_node.adjust_for_width(a.x2 - a.x1);

        if (width < nat_width) widget.width = nat_width;
    });
}

export function adjust_height (widget: St.Widget, child: Clutter.Actor = widget) {
    let destroyed = false;
    widget.connect('destroy', () => destroyed = true);

    run_before_redraw(() => {
        if (destroyed || !widget.is_mapped()) return;

        const theme_node   = widget.get_theme_node();
        const a            = widget.get_allocation_box();
        let [, nat_height] = child.get_preferred_height(a.x2 - a.x1);
        nat_height         = nat_height + theme_node.get_vertical_padding();
        const height       = theme_node.adjust_for_height(a.y2 - a.y1);

        if (height < nat_height) widget.height = nat_height;
    });
}

export function get_cell_box (widget: St.Widget): St.Widget {
    const layout = new Clutter.GridLayout();
    const table  = new St.Widget({ x_expand: true, layout_manager: layout });
    const cell   = new St.BoxLayout({ x_expand: true, vertical: true });
    layout.attach(cell, 0, 0, 1, 1);
    cell.add_actor(widget);
    return table;
}

export function play_sound (sound_file: string|null) {
    if (sound_file) {
        const player = global.display.get_sound_player();
        const file = Fs.file_new_for_path(sound_file);
        player.play_from_file(file, '', null);
    }
}

export function light_or_dark (r: number, g: number, b: number): 'light'|'dark' {
    const hsp = Math.sqrt(0.299*(r**2) + 0.587*(g**2) + 0.114*(b**2));
    return hsp > 127.5 ? 'light' : 'dark';
}

export function copy_to_clipboard (text: string) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}

export function array_swap <T> (array: Array<T>, a: number, b: number) {
    const tmp = array[a];
    array[a]  = array[b];
    array[b]  = tmp;
}

export function array_remove_idx <T> (array: Array<T>, element_idx: number) {
    if (element_idx !== -1) array.splice(element_idx, 1);
}

export function array_remove <T> (array: Array<T>, element: T) {
    array_remove_idx(array, array.indexOf(element));
}

export function * iter_set <T> (set: Set<T>): IterableIterator<[T, number]> {
    let idx = 0;

    for (const element of set) {
        yield [element, idx];
        idx++;
    }
}

// A simple O(n) search algorithm. First we look ahead in @haystack to see if
// all chars in @needle appear in the exact order, then we loop back to
// see if there is a shorter version. If a single @needle letter is
// missing from the text, we return null.
//
//     a  b  c d e  abcdef
//     ----------------->|
//                  |<----
//
// This algorithm does not try to find the optimal match:
//
//     a b  c d  e ab c def    abcdef
//     ------------------>|
//                 |<------
//
// The score is computed based on how many consecutive letters in the text
// were found, whether letters appear at word beginnings, number of gaps, ...
export function fuzzy_search (needle: string, haystack: string): number | null {
    const txt_len = haystack.length;
    const pat_len = needle.length;

    if (txt_len < pat_len) return null;

    let matches   = 0;
    let patt_pos  = 0;
    let start_pos = -1;
    let cursor    = 0;

    for (; cursor < txt_len; cursor++) {
        if (haystack[cursor] === needle[patt_pos]) {
            if (start_pos < 0) start_pos = cursor;
            if (++matches === pat_len) { cursor++; break; }
            patt_pos++;
        }
    }

    if (matches !== pat_len) return null;

    let gaps            = 0;
    let consecutives    = 0;
    let word_beginnings = 0;
    let last_match_idx  = 0;

    if (needle[0] === haystack[0]) word_beginnings++;

    while (cursor-- > start_pos) {
        if (haystack[cursor] === needle[patt_pos]) {
            if ((cursor + 1) === last_match_idx) consecutives++;
            if ((cursor > 1) && /\W/.test(haystack[cursor-1])) word_beginnings++;
            last_match_idx = cursor;
            patt_pos--;
        } else {
            gaps++;
        }
    }

    return (consecutives * 4) + (word_beginnings * 3) - gaps - start_pos;
}

export class Row <Widget extends St.Widget> {
    actor: St.BoxLayout;
    label: St.Label;
    widget: Widget;

    constructor (title: string|null, widget: Widget, parent?: St.Widget) {
        this.actor = new St.BoxLayout({ style_class: 'cronomix-row' });
        parent?.add_actor(this.actor);

        this.label = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_actor(this.label);

        this.widget = widget;
        this.actor.add_actor(widget);

        if (title !== null) {
            this.label.text      = title;
            this.widget.style  ??= '';
            this.widget.x_expand = true;
            this.widget.style   += 'margin-left: 20px;';
            this.widget.x_align  = Clutter.ActorAlign.END;
        } else {
            this.label.hide();
        }
    }
}

export class Card {
    actor: St.BoxLayout;
    header: St.BoxLayout;
    left_header_box: St.BoxLayout;
    autohide_box: St.BoxLayout;

    constructor () {
        this.actor = new St.BoxLayout({ reactive: true, vertical: true, x_expand: true, style_class: 'cronomix-card cronomix-box' });

        this.header = new St.BoxLayout({ style_class: 'header' });
        this.actor.add_actor(this.header);

        this.left_header_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, reactive: true, x_expand: true });
        this.header.add_actor(this.left_header_box);

        this.autohide_box = new St.BoxLayout({ visible: false });
        this.header.add_actor(this.autohide_box);

        const focus_tracker = new FocusTracker(this.actor);
        focus_tracker.subscribe('focus_enter', () => { scroll_to_widget(this.actor); this.autohide_box.show(); });
        focus_tracker.subscribe('focus_leave', (has_pointer) => this.autohide_box.visible = has_pointer);
        focus_tracker.subscribe('pointer_enter', () => this.autohide_box.show());
        focus_tracker.subscribe('pointer_leave', (has_focus) => this.autohide_box.visible = has_focus);
    }
}

// TODO(GNOME_BUG): Wrap content in this grid cell to work
// around a bug wherein a certain amount of padding appears
// at the bottom. The bug seems related to the layout of text.
export class CellBox {
    table: St.Widget;
    cell: St.BoxLayout;

    constructor (parent?: St.Widget, child?: St.Widget) {
        const layout = new Clutter.GridLayout();
        this.table   = new St.Widget({ x_expand: true, layout_manager: layout });
        this.cell    = new St.BoxLayout({ x_expand: true, vertical: true });

        layout.attach(this.cell, 0, 0, 1, 1);

        if (parent) parent.add_actor(this.table);
        if (child) this.cell.add_actor(child);
    }
}
