import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './../../utils/fs.js';
import { ext } from './../../extension.js';
import * as Misc from './../../utils/misc.js';
import { Popup } from './../../utils/popup.js';
import { Entry } from './../../utils/entry.js';
import { Button } from './../../utils/button.js';
import { Parser, AstBlock, idx_to_ast_path } from './parser.js';
import { ScrollBox, scroll_to_widget } from './../../utils/scroll.js';
import { Markup, MarkupPosition, RenderMetaFn } from './renderer.js';

export class Editor {
    actor: St.BoxLayout;
    left_box: St.BoxLayout;
    preview_scrollbox: ScrollBox;
    header_entry: St.BoxLayout;
    entry: Entry;
    entry_header: St.BoxLayout;

    preview: Markup; // editor calls render on this on text change
    ast = new Array<AstBlock>(); // updated on the text change
    position_info: MarkupPosition | null = null; // updated on text change or cursor motion

    on_text_changed?: () => void; // user supplied
    on_cursor_changed?: () => void; // user supplied
    get_completions?: (ref: string) => string[]; // user supplied

    #text_change_sig   = 0;
    #cursor_change_sig = 0;

    #completion_menu: Popup;
    #completion_menu_selected_entry = 0;
    #completion_entries: string[] | null = null;

    constructor (render_meta?: RenderMetaFn) {
        this.actor = new St.BoxLayout({ style_class: 'editor cronomix-spacing' });

        //
        // box containing the entry
        //
        this.left_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-spacing' });
        this.actor.add_child(this.left_box);

        //
        // headered entry
        //
        this.header_entry = new St.BoxLayout({ x_expand: true, style_class: 'cronomix-headered-entry', vertical: true });
        this.left_box.add_child(this.header_entry);

        //
        // entry header
        //
        this.entry_header = new St.BoxLayout({ x_expand: true, style: 'min-width: 256px;', style_class: 'header' });
        this.header_entry.add_child(this.entry_header);

        //
        // entry
        //
        this.entry = new Entry();
        this.header_entry.add_child(this.entry.actor);
        // Misc.focus_when_mapped(this.entry.entry);
        this.entry.entry.add_style_class_name('cronomix-markup-editor-entry');
        Misc.run_when_mapped(this.entry.entry, () => Misc.adjust_width(this.entry.entry, this.entry.entry.clutter_text));

        //
        // preview
        //
        const preview_wrapper = new ScrollBox(false);
        this.actor.add_child(preview_wrapper.actor);
        preview_wrapper.actor.style = 'min-width: 256px;';

        this.preview_scrollbox = new ScrollBox();
        preview_wrapper.box.add_child(this.preview_scrollbox.actor);

        this.preview = new Markup(this.entry.entry.text, this.ast, render_meta);
        this.preview_scrollbox.box.add_child(this.preview.actor);
        this.preview.actor.reactive = true;

        this.#sync_scroll();

        //
        // completion menu
        //
        this.#completion_menu = new Popup(this.actor, this.entry.entry, false, St.Side.BOTTOM);

        //
        // listen
        //
        this.actor.connect('destroy', () => {
            if (this.#cursor_change_sig) GLib.source_remove(this.#cursor_change_sig);
            if (this.#text_change_sig) GLib.source_remove(this.#text_change_sig);
        });
        this.preview.actor.connect('captured-event', (_:unknown, event: Clutter.Event) => {
            const t = event.type();

            if (t === Clutter.EventType.LEAVE || t === Clutter.EventType.ENTER) {
                return Clutter.EVENT_PROPAGATE;
            } else if (t === Clutter.EventType.SCROLL) {
                this.preview_scrollbox.actor.event(event, false);
                return Clutter.EVENT_STOP;
            } else {
                return Clutter.EVENT_STOP;
            }
        });
        this.entry.entry.clutter_text.connect('text-changed', () => {
            if (this.#text_change_sig) GLib.source_remove(this.#text_change_sig);

            this.#text_change_sig = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this.#text_change_sig = 0;
                this.#on_text_changed();
            });
        });
        this.entry.entry.clutter_text.connect('cursor-changed', () => {
            if (!this.#text_change_sig && !this.#cursor_change_sig) {
                this.#cursor_change_sig = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                    this.#cursor_change_sig = 0;
                    this.#on_cursor_changed();
                });
            }
        });
        this.entry.entry.clutter_text.connect('captured-event', (_:unknown, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;

            const symbol = event.get_key_symbol();

            switch (symbol) {
            case Clutter.KEY_Tab: {
                if (this.#completion_menu.is_open) {
                    this.#completion_menu_entry_clicked(this.#completion_menu_selected_entry);
                    return Clutter.EVENT_STOP;
                }
            } break;

            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter: {
                this.#on_enter_pressed();
                return Clutter.EVENT_STOP;
            }

            case Clutter.KEY_Up:
            case Clutter.KEY_Down: {
                if (this.#completion_menu.is_open) {
                    this.#navigate_completion_menu(symbol === Clutter.KEY_Up);
                    return Clutter.EVENT_STOP;
                }
            } break;
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }

    goto_position (pos: number) {
        this.entry.set_cursor_pos(pos, true);
        this.#completion_menu.close();
        this.#sync_scroll(true);
    }

    #get_cursor_position (): number {
        return this.entry.entry.clutter_text.get_cursor_position()
    }

    #on_text_changed () {
        const parser = new Parser(this.entry.entry.text);
        this.ast = [...parser.parse_blocks()];
        this.#update_preview();
        this.#update_completion_menu();
        this.on_text_changed?.();
    }

    #on_cursor_changed () {
        this.#completion_menu.close();
        this.#sync_scroll();
        this.on_cursor_changed?.();
    }

    #on_enter_pressed () {
        if (this.#completion_menu.is_open) {
            this.#completion_menu_entry_clicked(this.#completion_menu_selected_entry);
        } else {
            const text   = this.entry.entry.clutter_text;
            const pos    = this.#get_cursor_position();
            const path   = idx_to_ast_path(pos, this.ast);
            const node   = path.at(-1);
            const indent = node ? '  '.repeat(node.indent + (node.tag === 'AstMeta' ? 1 : 0)) : '';
            text.insert_text('\n' + indent, pos);
        }
    }

    #sync_scroll (scroll_to_top = false) {
        if (this.position_info) {
            const innermost_widget = this.position_info.widget_path.at(-1)!;
            innermost_widget.remove_style_class_name('highlight');
        }

        const pos = this.#get_cursor_position();
        this.position_info = this.preview.get_position_info(pos);

        const innermost_widget = this.position_info.widget_path.at(-1)!;
        innermost_widget.add_style_class_name('highlight');

        scroll_to_widget(innermost_widget, undefined, scroll_to_top);
    }

    #update_preview () {
        if (this.position_info) {
            const innermost_widget = this.position_info.widget_path.at(-1)!;
            innermost_widget.remove_style_class_name('highlight');
        }

        this.preview.render(this.entry.entry.text, this.ast);
        this.position_info = null;
        this.#sync_scroll();
    }

    #update_completion_menu () {
        const pos = this.#get_cursor_position();
        if (pos === 0) return;

        const path = idx_to_ast_path(pos - 1, this.ast);

        let ref: string|null = null;
        for (const node of path) {
            if (node.tag === 'AstTagRef') {
                ref = this.entry.entry.text.substring(node.start, node.end);
                break;
            }
        }

        if (ref && this.get_completions) {
            this.#show_completion_menu(this.get_completions(ref));
        } else {
            this.#completion_menu.close();
        }
    }

    #show_completion_menu (entries: string[]) {
        if (entries.length === 0) {
            this.#completion_menu.close();
            return;
        }

        this.#completion_entries = entries;
        this.#completion_menu.scrollbox.box.destroy_all_children();
        for (const entry of entries) new Button({ parent: this.#completion_menu.scrollbox.box, label: entry, style_class: 'cronomix-menu-button' });

        this.#select_completion_menu_entry(0);

        const text = this.entry.entry.clutter_text;
        const pos = this.#get_cursor_position();
        const [, x, y, line_height] = text.position_to_coords(pos);
        const p = text.apply_relative_transform_to_point(global.stage, new Graphene.Point3D({ x, y }));

        this.#completion_menu.open(p.x, p.y, 0, line_height);
    }

    #completion_menu_entry_clicked (entry_idx: number) {
        const text = this.entry.entry.clutter_text;
        const pos  = this.#get_cursor_position() - 1;
        const node = idx_to_ast_path(pos, this.ast).at(-1)!;

        text.delete_text(node.start, node.end);
        text.insert_text(this.#completion_entries![entry_idx], node.start);
    }

    #select_completion_menu_entry (idx: number) {
        const count = this.#completion_menu.scrollbox.box.get_n_children();

        if (idx < 0) {
            idx = 0;
        } else if (idx >= count) {
            idx = count - 1;
        }

        const prev_idx   = this.#completion_menu_selected_entry;
        const prev_entry = this.#completion_menu.scrollbox.box.get_child_at_index(prev_idx) as St.Widget;
        if (prev_entry) prev_entry.remove_style_pseudo_class('focus');

        const current_entry = this.#completion_menu.scrollbox.box.get_child_at_index(idx) as St.Widget;
        if (current_entry) {
            this.#completion_menu_selected_entry = idx;
            current_entry.add_style_pseudo_class('focus');
            scroll_to_widget(current_entry);
        }
    }

    #navigate_completion_menu (direction: boolean) {
        const idx = this.#completion_menu_selected_entry + (direction ? -1 : 1);
        this.#select_completion_menu_entry(idx);
    }
}

export class EditorHelp extends Editor {
    close_button: Button;

    constructor () {
        super();

        this.close_button = new Button({ parent: this.entry_header, icon: 'cronomix-close-symbolic' });
        this.entry_header.add_child(new St.Widget({ x_expand: true }));

        const table_of_contents = new ScrollBox();
        this.actor.insert_child_at_index(table_of_contents.actor, 0);

        const filters_docs = Fs.read_entire_file(ext.path + '/data/docs/filters') ?? '';
        const markup_docs  = Fs.read_entire_file(ext.path + '/data/docs/markup') ?? '';
        const tasks_docs   = Fs.read_entire_file(ext.path + '/data/docs/todo_tasks') ?? '';

        this.entry.set_text(markup_docs + '\n' + tasks_docs + '\n' + filters_docs, false);
        this.entry.set_cursor_pos(0);
        Misc.run_when_mapped(this.entry.entry, () => Misc.adjust_width(this.entry.entry, this.entry.entry.clutter_text));

        // If the cursor is below some header, then highlight
        // the corresponding entry in the table of contents.
        let selected_entry: St.Widget | null = null;
        this.on_cursor_changed = () => {
            selected_entry?.remove_style_pseudo_class('checked');

            const pos = this.position_info?.idx ?? 0;
            let cursor = 0;

            for (const node of this.ast) {
                if (node.tag !== 'AstHeader') continue;
                if (pos < node.start) break;
                selected_entry = table_of_contents.box.get_child_at_index(cursor++) as St.Widget;
            }

            selected_entry?.add_style_pseudo_class('checked');
        };

        // Re-render the table of contents.
        this.on_text_changed = () => {
            table_of_contents.box.destroy_all_children();

            let biggest_header = Number.MAX_SAFE_INTEGER;
            for (const block of this.ast) if (block.tag === 'AstHeader' && block.size < biggest_header) biggest_header = block.size;

            for (const block of this.ast) {
                if (block.tag !== 'AstHeader') continue;

                const label  = this.entry.entry.text.substring(block.child.start, block.child.end).trim();
                const button = new Button({ label, centered: false, parent: table_of_contents.box, style_class: 'cronomix-menu-button' });
                button.actor.style = `padding-top: 2px; padding-bottom: 2px; margin-left: ${block.size - biggest_header}em;`;
                button.subscribe('left_click', () => this.goto_position(block.start));
            }

            selected_entry = null;
            table_of_contents.actor.visible = table_of_contents.box.get_n_children() > 0;
            this.on_cursor_changed?.();
        };
    }
}

export class EditorView {
    actor:      St.BoxLayout;
    main_view:  Editor;
    help_view?: EditorHelp;
    show_help_button: Button;

    constructor (render_meta?: RenderMetaFn) {
        this.actor = new St.BoxLayout({ reactive: true });

        this.main_view = new Editor(render_meta);
        this.actor.add_child(this.main_view.actor);

        this.main_view.entry_header.add_child(new St.Widget({ x_expand: true }));
        this.show_help_button = new Button({ parent: this.main_view.entry_header, icon: 'cronomix-question-symbolic' });

        this.show_help_button.subscribe('left_click', () => this.toggle_help_view());
        this.actor.connect('captured-event', (_:unknown, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
            if (event.get_key_symbol() === Clutter.KEY_F1) { this.toggle_help_view(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    toggle_help_view () {
        if (this.help_view?.actor.visible) {
            Misc.focus_when_mapped(this.main_view.entry.entry);
            this.main_view.actor.visible = true;
            this.help_view.actor.visible = false;
        } else if (this.help_view) {
            Misc.focus_when_mapped(this.help_view.entry.entry);
            this.main_view.actor.visible = false;
            this.help_view.actor.visible = true;
        } else {
            this.help_view = new EditorHelp();
            this.actor.add_child(this.help_view.actor);
            this.help_view.close_button.subscribe('left_click', () => this.toggle_help_view());
            this.main_view.actor.visible = false;
        }
    }
}
