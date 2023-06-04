import * as St from 'imports.gi.St';
import * as GLib from 'imports.gi.GLib';
import * as Meta from 'imports.gi.Meta';
import * as Pango from 'imports.gi.Pango';
import * as Clutter from 'imports.gi.Clutter';

import * as Fs from 'utils/fs';
import * as Ext from 'extension';
import * as Misc from 'utils/misc';
import { Image } from 'utils/image';
import * as P from 'utils/markup/parser';
import { _, unreachable } from 'utils/misc';

export class MarkupPosition {
    idx!: number;
    text!: string;

    ast_path = Array<P.Ast>();
    ast_paragraph?: P.AstParagraph;
    widget_path = Array<St.Widget>();

    clutter_text_idx = 0;
    clutter_text?: Clutter.Text;
}

// By default the widget will deal with AstMeta nodes
// by just rendering their body. Use this function to
// place the body within another widget for example.
export type RenderMetaFn = (text: string, ast: P.AstMeta, body: St.Widget) => St.Widget | null;

export class Markup {
    actor!: St.BoxLayout;
    on_tag_clicked?: (node: P.AstTagRef) => void;

    #text!: string;
    #ast!: P.AstBlock[];
    #custom_render_meta?: RenderMetaFn;

    #content!: St.BoxLayout;
    #paragraph_length!: number;
    #clickables = new Array<Clickable>();
    #ast_to_widget = new Map<P.Ast, St.Widget|null>();

    // Maps inline leaf nodes to a character offset within a rendered paragraph.
    #inline_clutter_idx = new Map<P.Ast, number>();

    // Used for caching widgets between render cycles.
    #current_cache = new Map<string, St.Widget[]>();
    #next_cache = new Map<string, St.Widget[]>();

    constructor (text: string, nodes?: P.AstBlock[], render_meta?: RenderMetaFn) {
        if (render_meta) this.#custom_render_meta = render_meta;
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-markup' });
        this.render(text, nodes);
    }

    get_position_info (idx: number): MarkupPosition {
        if (idx < 0 || idx >= this.#text.length) idx = this.#text.length - 1;

        const info      = new MarkupPosition();
        info.idx        = idx;
        info.text       = this.#text;
        info.ast_path   = P.idx_to_ast_path(idx, this.#ast);
        const innermost = info.ast_path.at(-1);

        if (innermost?.tag === 'AstParagraph') {
            info.ast_paragraph = innermost;

            // Transform the markup index to the Clutter.Text relative index:
            const label = this.#ast_to_widget.get(info.ast_paragraph) as St.Label;
            if (label) {

                const inline = info.ast_path.at(-1)!;
                const inline_clutter_idx = this.#inline_clutter_idx.get(inline)!;
                info.clutter_text_idx = inline_clutter_idx + (info.idx - inline.start);
                info.clutter_text = label.clutter_text;
            }
        }

        // Build widget path:
        for (const node of info.ast_path) {
            const widget = this.#ast_to_widget.get(node);
            if (widget) info.widget_path.push(widget);
            if (node.tag === 'AstParagraph') break; // Inline nodes don't have corresponding widgets.
        }

        return info;
    }

    // IMPORTANT: This function caches widgets to speed up re-rendering.
    // If you call this function more than once, links and tags will
    // stop being clickable. It's not a problem since we only re-render
    // when in the editor where we don't need the links to be clickable.
    render (text: string, nodes?: P.AstBlock[]) {
        this.#inline_clutter_idx.clear();
        this.#ast_to_widget.clear();
        this.#clickables.length = 0;
        this.#paragraph_length = 0;
        this.#text = text;

        if (nodes) {
            this.#ast = nodes;
        } else {
            const parser = new P.Parser(text);
            this.#ast = [...parser.parse_blocks()];
        }

        if (this.#ast.length === 0) {
            const dummy_ast  = new P.AstDummy();
            dummy_ast.start  = 0;
            dummy_ast.end    = 0;
            dummy_ast.indent = 0;
            this.#ast.push(dummy_ast);
        }

        // Hold onto the old widget tree so we can reuse some widgets.
        const prev_content = this.#content;
        this.#content = new St.BoxLayout({ reactive: true, vertical: true, x_expand: true, style_class: 'cronomix-spacing' });

        this.actor.remove_all_children();
        this.actor.add_actor(this.#content);

        for (const block of this.#ast) this.#content.add_actor(this.#render_block(block));

        // Get rid of unused widgets.
        prev_content?.destroy();
        this.#current_cache.clear();
        [this.#current_cache, this.#next_cache] = [this.#next_cache, this.#current_cache];
    }

    // Try to reuse an old widget, if not possible make a new one.
    // A reused widget will be detached from it's old parent.
    // If @is_leaf is true the children will be detached.
    #widget (node: P.Ast, make: () => St.Widget, is_leaf = false): St.Widget {
        const text = this.#text.substring(node.start, node.end);
        let result = this.#current_cache.get(text)?.pop();

        if (result) {
            result.get_parent()?.remove_child(result);
            if (! is_leaf) result.remove_all_children?.();
        } else {
            result = make();
        }

        // Cache the widget for the next render cycle.
        let bucket = this.#next_cache.get(text);
        if (! bucket) { bucket = []; this.#next_cache.set(text, bucket); }
        bucket.push(result);

        return result;
    }

    #render_block (block: P.AstBlock): St.Widget {
        let result: St.Widget;

        switch (block.tag) {
        case 'AstList':
        case 'AstOrderedList': {
            const ordered = (block.tag === 'AstOrderedList');
            result = this.#widget(block, () => new St.BoxLayout({ vertical: true }));
            result.style_class = ordered ? 'ordered-list' : 'list';

            for (const [idx, child] of block.children.entries()) {
                const item = new St.BoxLayout();
                result.add_actor(item);
                this.#ast_to_widget.set(child, item);

                const bullet = new St.Label({ text: ordered ? (idx + 1) + '.' : '•', style_class: 'bullet' });
                item.add_actor(bullet);

                const content = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'block cronomix-spacing' });
                item.add_actor(content);

                for (const c of child.children) content.add_actor(this.#render_block(c));
            }
        } break;

        case 'AstHeader': {
            result = this.#widget(block, () => new St.BoxLayout());
            result.style_class = 'header h' + block.size;
            result.add_actor(this.#render_block(block.child));
            result;
        } break;

        case 'AstRawBlock': {
            result = this.#widget(block, () => new St.BoxLayout({ vertical: true, reactive: true, style_class: 'raw-block' }));
            for (const child of block.children) result.add_actor(this.#render_block(child));
            result;
        } break;

        case 'AstMeta':      result = this.#render_meta(block); break;
        case 'AstDummy':     result = new St.Widget({ style_class: 'dummy' }); break;
        case 'AstTable':     result = this.#render_table(block); break;
        case 'AstSeparator': result = new St.Widget({ x_expand: true, style_class: 'separator' }); break;
        case 'AstParagraph': result = this.#widget(block, () => this.#render_paragraph(block), true); break;

        case 'AstListItem':
        case 'AstTableRow':
        case 'AstTableCell':
            throw Error('unreachable');

        default: unreachable(block);
        }

        this.#ast_to_widget.set(block, result);
        result.add_style_class_name('block cronomix-spacing');
        return result;
    }

    #render_meta (meta: P.AstMeta): St.Widget {
        const body = new St.BoxLayout({ reactive: true, vertical: true, style_class: 'block cronomix-spacing' });
        for (const child of meta.children) body.add_actor(this.#render_block(child));

        if (this.#custom_render_meta) {
            const result = this.#custom_render_meta(this.#text, meta, body);
            if (result) return result;
        }

        if (meta.config.image) {
            const info = meta.config.image!;
            return this.#widget(meta, () => new Image(info.path, 300, info.width).actor, true);
        } else if (meta.config.admonition !== undefined) {
            const admonition = this.#widget(meta, () => new St.BoxLayout({ vertical: true }));
            admonition.style_class = `admonition ${meta.config.admonition} cronomix-group`;

            const header = new St.BoxLayout({ style_class: 'header' });
            admonition.add_actor(header);

            const label = new St.Label({ text: Admonition[meta.config.admonition] });
            header.add_actor(label);

            admonition.add_actor(body);
            return admonition;
        } else {
            return body;
        }
    }

    #render_table (table: P.AstTable): St.Widget {
        const layout = new Clutter.GridLayout();
        const actor  = new St.Widget({ x_expand: true, layout_manager: layout, style_class: 'table' });
        Misc.run_when_mapped(actor, () => Misc.adjust_width(actor));

        const col_count = table.children[0].children.length;
        const row_count = table.children.length;

        const widget_to_ast = new Map<St.Widget, P.AstTableCell>();

        // This map tells whether the nth cell of the current row is
        // occupied by another cell due to a cell spanning multiple
        // rows or columns. If the value here is greater than 0, the
        // cell is occupied, and the number indicates how many more
        // cells below this one (in the same column) are occupied.
        const occupied = new Uint32Array(col_count);

        // This map tells whether the cells to the left and above
        // the current one are visible or not.
        const visible = new Uint8Array(col_count);

        const dummy_cell  = new P.AstTableCell();
        dummy_cell.config = new P.AstTableCellConfig();

        for (const [row_idx, row] of table.children.entries()) {
            const remaining_rows = row_count - row_idx;

            // Add missing cells in this row in the form of dummy cells:
            const prev_row_length = row.children.length;
            while (row.children.length < col_count) row.children.push(dummy_cell);

            // Render the cells of this row:
            for (const [col_idx, cell] of row.children.entries()) {
                if (occupied[col_idx]) continue;
                if (col_idx === col_count) break; // Ignore excess cells.

                const above_cell_is_visible = visible[col_idx];
                const left_cell_is_visible  = col_idx && visible[col_idx-1];

                const final_height = (cell.config.height === '*') ? remaining_rows : Math.min(cell.config.height, remaining_rows);
                let final_width    = 0;

                { // Compute final width and update occupied and visible maps:
                    const remaining_cols  = col_count - col_idx;
                    const preferred_width = (cell.config.width === '*') ? remaining_cols : Math.min(cell.config.width, remaining_cols);

                    for (let w=0, idx=col_idx; idx < col_count; w++, idx++) {
                        if (occupied[idx] || (w === preferred_width)) break;
                        occupied[idx] = final_height;
                        visible[idx]  = cell.config.invisible ? 0 : 1;
                        final_width++;
                    }
                }

                { // Add cell widget:
                    const cell_widget = this.#widget(cell, () => new St.BoxLayout({ x_expand: true, vertical: true }));
                    cell_widget.style_class = 'block cell';
                    this.#ast_to_widget.set(cell, cell_widget);
                    widget_to_ast.set(cell_widget, cell);

                    if (cell.config.invisible) {
                        cell_widget.add_style_class_name('invisible');
                        if (! above_cell_is_visible) cell_widget.add_style_class_name('no-top-border');
                        if (! left_cell_is_visible) cell_widget.add_style_class_name('no-left-border');
                    }

                    if (row_idx === 0) cell_widget.add_style_class_name('first-row');
                    if (row_idx + final_height === row_count) cell_widget.add_style_class_name('last-row');
                    if (col_idx === 0) cell_widget.add_style_class_name('first-col');
                    if (col_idx + final_width === col_count) cell_widget.add_style_class_name('last-col');

                    if (cell.children) for (const child of cell.children) cell_widget.add_actor(this.#render_block(child));
                    layout.attach(cell_widget, col_idx, row_idx, final_width, final_height);
                }
            }

            row.children.length = prev_row_length; // Remove dummy cells.
            for (const [idx, val] of occupied.entries()) if (val) occupied[idx]--;
        }

        return actor;
    }

    #render_paragraph (paragraph: P.AstParagraph): St.Widget {
        const result = new St.Label({ x_expand: true, reactive: true, style_class: 'paragraph' });

        // TODO(GNOME_BUG): We prepend the unicode zero-width space character to
        // each paragraph to avoid a bug where the first characters get no color.
        let markup = '​';
        this.#paragraph_length = 1;
        for (const child of paragraph.children) markup += this.#render_inline(child);

        result.clutter_text.set_markup(markup);
        result.clutter_text.single_line_mode = false;
        result.clutter_text.selectable       = true;
        result.clutter_text.line_wrap        = true;
        result.clutter_text.line_wrap_mode   = Pango.WrapMode.WORD_CHAR;
        result.clutter_text.ellipsize        = Pango.EllipsizeMode.NONE;

        // TODO(GNOME_BUG): We remove the last newline character from paragraphs so
        // that we don't end up with a weird extra empty line below each paragraph.
        let txt = result.clutter_text.text;
        if (txt.at(-1) === '\n') result.clutter_text.delete_text(txt.length-1, txt.length);

        // We append a space character to act as a sentinel value for the
        // algorithm below which transforms mouse coordinates to a character
        // index. The only reason we have to do this is because we potentially
        // deleted the last newline character.
        result.clutter_text.insert_text(' ', -1);

        { // Make the clickables reactive:
            const clickables = this.#clickables;
            this.#clickables = [];
            let hovered_clickable: Clickable | null = null;

            result.connect('motion-event', (_:unknown, event: Clutter.Event) => {
                const [, x, y] = result.clutter_text.transform_stage_point(...event.get_coords());

                // Find the index of the character we're pointing at:
                let idx = -1;
                for (let i = 0; i < result.clutter_text.text.length; i++) {
                    const [, px, py, line_height] = result.clutter_text.position_to_coords(i);
                    if (py > y || py + line_height < y || x < px) continue;
                    idx = i;
                }

                if (idx !== -1) {
                    for (const clickable of clickables) {
                        if (idx >= clickable.start && idx < clickable.end) {
                            global.display.set_cursor(Meta.Cursor.POINTING_HAND);
                            hovered_clickable = clickable;
                            return Clutter.EVENT_PROPAGATE;
                        }
                    }
                }

                hovered_clickable = null;
                global.display.set_cursor(Meta.Cursor.DEFAULT);
                return Clutter.EVENT_PROPAGATE;
            });

            result.connect('leave-event', () => {
                hovered_clickable = null;
                global.display.set_cursor(Meta.Cursor.DEFAULT);
            });

            result.connect('button-release-event', () => {
                if (hovered_clickable) {
                    if (hovered_clickable.node.tag === 'AstLink') {
                        Fs.open_web_uri_in_default_app(hovered_clickable.node.link);
                    } else if (hovered_clickable.node.tag === 'AstTagRef') {
                        this.on_tag_clicked?.(hovered_clickable.node);
                    }

                }
            });
        }

        return result;
    }

    // IMPORTANT:
    //
    //   - If an inline node inserts text into the paragraph, then make
    //     sure to increment this.#paragraph_length by the amount of text
    //     inserted.
    //
    //   - Add each leaf inline node to this.#inline_clutter_idx. Even if
    //     that node's text is not added to the rendered paragraph it must
    //     still be added. For example, the link part of an AstLink node
    //     will not be rendered if the there is an alias, but we include
    //     it into this map anyway.
    //
    #render_inline (node: P.AstInline): string {
        switch (node.tag) {
        case 'AstText': {
            this.#inline_clutter_idx.set(node, this.#paragraph_length);
            const text = this.#text.substring(node.start, node.end);
            this.#paragraph_length += text.length;
            return GLib.markup_escape_text(text, -1);
        }

        case 'AstBold': {
            let result = '<b>';
            for (const child of node.children) result += this.#render_inline(child);
            result += '</b>';
            return result;
        }

        case 'AstItalic': {
            let result = '<i>';
            for (const child of node.children) result += this.#render_inline(child);
            result += '</i>';
            return result;
        }

        case 'AstStrike': {
            let result = '<s>';
            for (const child of node.children) result += this.#render_inline(child);
            result += '</s>';
            return result;
        }

        case 'AstSup': {
            let result = '<sup>';
            for (const child of node.children) result += this.#render_inline(child);
            result += '</sup>';
            return result;
        }

        case 'AstSub': {
            let result = '<sub>';
            for (const child of node.children) result += this.#render_inline(child);
            result += '</sub>';
            return result;
        }

        case 'AstHighlight': {
            const fg = Ext.colors['-cronomix-markup-highlight-fg'];
            const bg = Ext.colors['-cronomix-markup-highlight-bg'];

            this.#paragraph_length++; // for the space we prepend
            let result = `<b><span color="${fg}" bgcolor="${bg}"> `;
            for (const child of node.children) result += this.#render_inline(child);

            result = result.endsWith('\n') ?
                     result.substring(0, result.length - 1) + ' </span></b>\n' :
                     result + ' </span></b>';

            this.#paragraph_length++; // for the space we append
            return result;
        }

        case 'AstRawInline': {
            let result = '';

            if (node.monospace) {
                const fg = Ext.colors['-cronomix-markup-raw-fg'];
                const bg = Ext.colors['-cronomix-markup-raw-bg'];

                result = `<span color="${fg}" bgcolor="${bg}"> `;
                this.#paragraph_length++;
                for (const child of node.children) result += this.#render_inline(child);

                result = result.endsWith('\n') ?
                         result.substring(0, result.length - 1) + ' </span>\n' :
                         result + ' </span>';

                this.#paragraph_length++;
            } else {
                for (const child of node.children) result += this.#render_inline(child);
            }

            return result;
        }

        case 'AstLink': {
            let result = `<b><span foreground="${Ext.colors['-cronomix-link-color']}">`;

            const start = this.#paragraph_length;
            this.#inline_clutter_idx.set(node, start);

            if (node.alias) {
                this.#paragraph_length += node.alias.length;
                result += node.alias;
            } else {
                this.#paragraph_length += node.link.length;
                result += node.link;
            }

            result += '</span></b>';
            this.#clickables.push({ node, start, end: this.#paragraph_length });

            return result;
        }

        case 'AstTagRef': {
            let result = `<b><span foreground="${Ext.colors['-cronomix-tag-ref-color']}">`;
            const start = this.#paragraph_length;
            result += this.#render_inline(node.child);
            result += '</span></b>';
            this.#clickables.push({ node, start, end: this.#paragraph_length });
            return result;
        }

        default: unreachable(node);
        }
    }
}

const Admonition: Record<P.Admonition, string> = {
    tip: _('Tip'),
    note: _('Note'),
    warning: _('Warning'),
    important: _('Important'),
};

type Clickable = {
    node: P.AstInline;
    start: number;
    end: number;
}
