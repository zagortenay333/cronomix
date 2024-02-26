import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TodoApplet } from './main.js';
import * as Misc from './../../utils/misc.js';
import { Popup } from './../../utils/popup.js';
import { unreachable } from './../../utils/misc.js';
import * as P from './../../utils/markup/parser.js';
import { get_iso_date } from './../../utils/time.js';
import { Markup } from './../../utils/markup/renderer.js';
import { EditorView } from './../../utils/markup/editor.js';
import { ButtonBox, Button, CheckBox } from './../../utils/button.js';

export class Task {
    text: string;
    ast: P.AstMeta;

    constructor (text: string, ast: P.AstMeta) {
        this.text = text;
        this.ast = ast;
    }

    satisfies_filter (filter: P.AstFilter): boolean {
        const config = this.ast.config;

        if (config.hide) {
            if (filter.tag === 'AstFilterAny' || filter.tag === 'AstFilterHide') return true;
            if (! (filter.tag === 'AstFilterAnd' && filter.op1.tag === 'AstFilterHide')) return false;
        }

        return this.#satisfies_filter(filter);
    }

    #satisfies_filter (filter: P.AstFilter): boolean {
        const config = this.ast.config;

        switch (filter.tag) {
        case 'AstFilterAny':      return true;
        case 'AstFilterNot':      return !this.#satisfies_filter(filter.op);
        case 'AstFilterOr':       return this.#satisfies_filter(filter.op1) || this.#satisfies_filter(filter.op2);
        case 'AstFilterAnd':      return this.#satisfies_filter(filter.op1) && this.#satisfies_filter(filter.op2);
        case 'AstFilterDue':      return !!config.due;
        case 'AstFilterDone':     return !!config.done;
        case 'AstFilterPin':      return !!config.pin;
        case 'AstFilterHide':     return !!config.hide;
        case 'AstFilterTrack':    return (filter.id > -1) ? (filter.id === config.track) : (config.track !== undefined);
        case 'AstFilterFuzzy':    return Misc.fuzzy_search(filter.needle, this.text) !== null;
        case 'AstFilterString':   return this.text.indexOf(filter.needle) !== -1;
        case 'AstFilterTag':      return !!config.tags && ((filter.text === '@') ? (config.tags.size > 0) : config.tags.has(filter.text));
        case 'AstFilterPriority': return !!config.priority && (filter.priority ? (config.priority === filter.priority) : (config.priority > 0));
        default: unreachable(filter);
        }
    }

    serialize_header () {
        const config = this.ast.config;

        const body_start = this.ast.children.at(0)?.start ?? 0;
        const body_end   = this.ast.children.at(-1)?.end ?? 0;
        const body_text  = this.text.substring(body_start, body_end);

        // Estimate length of header if it were on 1 line:
        let header_len = 2; // +2 for the brackets.
        if (config.priority) header_len += 2;
        if (config.done)     header_len += 2;
        if (config.pin)      header_len += 4;
        if (config.hide)     header_len += 5;
        if (config.due)      header_len += 15;
        if (config.track !== undefined) header_len += 8;
        if (config.tags)     for (const tag of config.tags) header_len += tag.length + 1;

        const idx = body_text.indexOf('\n');
        const is_single_line = idx === -1 || idx === body_text.length - 1;

        let new_header: string;

        if (is_single_line && header_len < 30 && (body_text.length + header_len) <= 120) {
            new_header = this.#serialize_header_style1();
        } else if (header_len < 80) {
            new_header = this.#serialize_header_style2();
        } else {
            new_header = this.#serialize_header_style3();
        }

        { // Adjust ast node offsets now that the header changed:
            const adjust = new_header.length - body_start;
            for (const node of P.iter(this.ast.children)) { node.start += adjust; node.end += adjust; }
            this.ast.end += adjust;
        }

        this.text = new_header + body_text;
    }

    // [x @foo] Lorem impsum.
    #serialize_header_style1 (): string {
        let result = '[';
        const config = this.ast.config;

        if (config.done)     result += 'x ';
        if (config.priority) result += '#' + config.priority + ' ';
        if (config.due)      result += 'due:' + config.due + ' ';
        if (config.pin)      result += 'pin ';
        if (config.hide)     result += 'hide ';
        if (config.track !== undefined) result += 'track:' + config.track + ' ';
        if (config.tags)     for (const tag of config.tags) result += tag + ' ';

        return result.trimRight() + '] ';
    }

    // [x @foo]
    //   Lorem impsum.
    #serialize_header_style2 (): string {
        return this.#serialize_header_style1() + '\n  ';
    }

    // [ x
    //   @foo
    // ]
    //   Lorem impsum.
    #serialize_header_style3 (): string {
        let result = '[ ';
        const config = this.ast.config;

        if (config.done)     result += 'x\n  ';
        if (config.priority) result += '#' + config.priority + '\n  ';
        if (config.due)      result += 'due:' + config.due + '\n  ';
        if (config.pin)      result += 'pin\n  ';
        if (config.hide)     result += 'hide\n  ';
        if (config.track !== undefined) result += 'track:' + config.track + '\n  ';
        if (config.tags)     for (const [tag, idx] of Misc.iter_set(config.tags)) result += tag + ' ' + ((idx+1)%6 ? '' : '\n  ');

        if (result.at(-1) !== '\n') result += '\n';
        return result + ']\n  ';
    }
}

export class TaskCard extends Misc.Card {
    constructor (applet: TodoApplet, task: Task, body?: St.Widget) {
        super();

        const config = task.ast.config;

        this.left_header_box.add_style_class_name('cronomix-spacing');

        const checkbox        = new CheckBox({ parent: this.left_header_box, checked: !!config.done });
        if (config.created)   this.left_header_box.add_actor(new St.Label({ text: _('Created') + ' ' + config.created, y_align: Clutter.ActorAlign.CENTER, style: 'font-weight: bold', style_class: 'cronomix-green' }));
        const due_button      = !config.due ? null : new Button({ parent: this.left_header_box, label: _('Due') + ' ' + config.due, style_class: 'cronomix-floating-button cronomix-red' });
        const delete_button   = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic' , style_class: 'cronomix-floating-button'});
        const edit_button     = new Button({ parent: this.autohide_box, icon: 'cronomix-edit-symbolic', style_class: 'cronomix-floating-button' });
        const tracker_button  = new Button({ parent: this.autohide_box, icon: 'cronomix-time-tracker-symbolic' , style_class: 'cronomix-floating-button'});
        const pin_button      = new Button({ parent: config.pin ? this.header : this.autohide_box, icon: 'cronomix-pin-symbolic' , style_class: 'cronomix-floating-button'});
        const priority_button = !config.priority ? null : new Button({ parent: this.header, label: '#' + config.priority, style_class: 'cronomix-floating-button cronomix-red' });
        const hide_button     = !config.hide ? null : new Button({ parent: this.header, icon: 'cronomix-hidden-symbolic', style_class: 'cronomix-floating-button' });

        if (config.tags) {
            let box = new St.BoxLayout({ style_class: 'cronomix-spacing' });
            this.actor.insert_child_above(box, this.header);

            for (const tag of config.tags) {
                const button = new Button({ parent: box, label: tag, style_class: 'cronomix-tag-button cronomix-yellow' });
                button.subscribe('left_click', () => applet.show_search_view(tag));
                if (box.get_n_children() === 5) {
                    const old_box = box;
                    box = new St.BoxLayout({ style_class: 'cronomix-spacing' });
                    this.actor.insert_child_above(box, old_box);
                }
            }
        }

        if (body) {
            this.actor.add_actor(body);
        } else {
            const markup = new Markup(task.text, task.ast.children);
            this.actor.add_actor(markup.actor);
            markup.on_tag_clicked = node => applet.show_search_view(task.text.substring(node.start, node.end));
        }

        edit_button.subscribe('left_click', () => applet.show_task_editor(task));
        delete_button.subscribe('left_click', () => applet.show_search_view(task));
        priority_button?.subscribe('left_click', () => applet.show_search_view('#' + config.priority));
        due_button?.subscribe('left_click', () => applet.show_search_view('due'));
        hide_button?.subscribe('left_click', () => applet.show_search_view('hide'));
        pin_button.subscribe('left_click', () => {
            task.ast.config.pin = !task.ast.config.pin;
            task.serialize_header();
            applet.flush_tasks();
            applet.show_main_view();
            applet.tracker.update_slot(task);
        });
        checkbox.subscribe('left_click', () => {
            task.ast.config.done = !task.ast.config.done;
            task.serialize_header();
            applet.flush_tasks();
            applet.show_main_view();
            applet.tracker.update_slot(task);
        });
        tracker_button.subscribe('left_click', () => {
            const popup = new TimeTrackerPopup(applet, task, tracker_button);
            popup.open_at_widget(tracker_button);
        });
    }
}

class TimeTrackerPopup extends Popup {
    #applet: TodoApplet;
    #task: Task;
    #sid = 0;

    constructor (applet: TodoApplet, task: Task, at: Button) {
        super(at.actor, undefined, true);
        this.#applet = applet;
        this.#task = task;
        super.on_close = () => applet.tracker.unsubscribe(this.#sid);
        this.#update_ui();
    }

    #update_ui () {
        const box     = this.scrollbox.box;
        const tracker = this.#applet.tracker;
        const slot    = tracker.get_slot(this.#task);

        box.destroy_all_children();
        this.boxpointer.width = -1;

        if (! slot) {
            const label = new St.Label({ text: _('No time tracker file selected.') });
            box.add_actor(label);
            const button = new Button({ parent: box, wide: true, label: _('Open time tracker settings') });
            Misc.focus_when_mapped(button.actor);
            button.subscribe('left_click', () => {
                this.close();
                this.#applet.show_tracker_view();
            });
        } else if (slot.task.text !== this.#task.text) {
            const msg = _('The text of the corresponding tracker slot does not match this task.') + '\n\n' +
                        _('Here is what the text in the slot currently looks like:') + '\n' +
                        '>' + slot.task.text.replaceAll('\n', '\n  ') + '\n' +
                        _('You can do one of the following:') + '\n' +
                        '-  ' + _('Create a new slot leaving the old one in the tracker.') + '\n' +
                        '-  ' + _('Update the current slot to match with this task.');
            box.add_actor(new Markup(msg).actor);

            const button_box    = new ButtonBox(box);
            const insert_button = button_box.add({ wide: true, label: _('Create new slot') });
            const update_button = button_box.add({ wide: true, label: _('Update current slot') });
            Misc.focus_when_mapped(insert_button.actor);

            insert_button.subscribe('left_click', () => {
                delete this.#task.ast.config.track;
                this.#task.serialize_header();
                this.#applet.flush_tasks();
                this.#update_ui();
            });
            update_button.subscribe('left_click', () => {
                tracker.update_slot(this.#task);
                this.#update_ui();
            });
        } else if (tracker.tic && tracker.tracked_slot === slot) {
            const time_label = new St.Label({ text: tracker.time.fmt_hms(), style: 'font-weight: bold;', style_class: 'cronomix-yellow' });
            box.add_actor(time_label);

            const buttons      = new ButtonBox(box);
            const ctrl_button  = buttons.add({ wide: true, label: _('Stop tracking') });
            const stats_button = buttons.add({ wide: true, label: _('Stats') });
            Misc.focus_when_mapped(ctrl_button.actor);

            this.#sid = tracker.subscribe('tic', () => time_label.text = tracker.time.fmt_hms());
            stats_button.subscribe('left_click', () => this.#applet.show_tracker_view(this.#task));
            ctrl_button.subscribe('left_click', () => {
                tracker.stop();
                tracker.unsubscribe(this.#sid);
                this.#sid = 0;
                this.#update_ui();
            });
        } else {
            const buttons      = new ButtonBox(box);
            const ctrl_button  = buttons.add({ wide: true, label: _('Start tracking') });
            const stats_button = buttons.add({ wide: true, label: _('Stats') });
            Misc.focus_when_mapped(ctrl_button.actor);
            stats_button.subscribe('left_click', () => this.#applet.show_tracker_view(this.#task));
            ctrl_button.subscribe('left_click', () => { tracker.start(slot); this.#update_ui(); });
        }
    }
}

export class TaskEditor extends EditorView {
    #task?: Task|null;
    #applet: TodoApplet;
    #tags: Set<string> | null = null;

    constructor (applet: TodoApplet, task?: Task) {
        super((text, ast, body) => {
            if (ast.indent > 0) return null
            const task = new Task(text, ast);
            const card = new TaskCard(this.#applet, task, body);
            return card.actor;
        });

        this.#applet = applet;
        if (task) this.#task = task;

        const initial_text = task?.text ?? `[created:${get_iso_date()}] `;
        this.main_view.entry.set_text(initial_text, false);

        this.main_view.get_completions = ref => {
            if (! this.#tags) {
                this.#tags = new Set<string>();

                for (const task of this.#applet.tasks) {
                    for (const tag of task.ast.config.tags ?? []) {
                        this.#tags.add(tag);
                    }
                }
            }

            const result = [];
            for (const tag of this.#tags) if (tag.startsWith(ref) && (tag.length > ref.length)) result.push(tag);
            return result;
        };

        const button_box    = new ButtonBox(this.main_view.left_box);
        const button_ok     = button_box.add({ wide: true, label: _('Ok') });
        const button_cancel = button_box.add({ wide: true, label: _('Cancel') });

        button_ok.subscribe('left_click', () => this.#on_ok_pressed());
        button_cancel.subscribe('left_click', () => this.#applet.show_main_view());
    }

    destroy () {
        this.actor.destroy();
    }

    #on_ok_pressed () {
        const parser = new P.Parser(this.main_view.entry.entry.text);

        for (const [block_text, block_ast] of parser.parse_blocks_split()) {
            if (block_ast.tag !== 'AstMeta') {
                this.#applet.non_tasks.push(block_text);
            } else if (this.#task) {
                this.#task.text = block_text;
                this.#task.ast  = block_ast;
                this.#task      = null;
            } else {
                this.#applet.tasks.push(new Task(block_text, block_ast));
            }
        }

        if (this.#task) {
            const t = this.#applet.tracker;
            if (t.is_tracking(this.#task)) t.stop();
            Misc.array_remove(this.#applet.tasks, this.#task);
        }

        this.#applet.flush_tasks();
        this.#applet.show_main_view();
    }
}
