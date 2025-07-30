import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './../utils/fs.js';
import * as Misc from './../utils/misc.js';
import { Cronomix } from './../extension.js';
import { Storage } from './../utils/storage.js';
import { IntPicker } from './../utils/pickers.js';
import { LazyScrollBox } from './../utils/scroll.js';
import { Markup } from './../utils/markup/renderer.js';
import { EditorView } from './../utils/markup/editor.js';
import { Button, ButtonBox } from './../utils/button.js';
import { Applet, PanelPosition, PanelPositionTr } from './applet.js';
import { show_info_popup, show_confirm_popup } from './../utils/popup.js';

export type Deck = {
    version: number;
    session: number;
    cards: Card[];
}

export type Card = {
    bucket: number;
    question: string;
    answer: string;
}

export class FlashcardsApplet extends Applet {
    storage = new Storage({
        version: 0,
        file: '~/.config/cronomix/flashcards.json',

        values: {
            deck:           { tag: 'file',   value: null },
            panel_position: { tag: 'enum',   value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            open:           { tag: 'keymap', value: null },
            add_card:       { tag: 'keymap', value: null },
        },

        groups: [
            ['deck'],
            ['panel_position'],
            ['open', 'add_card'],
        ],

        infos: {
            deck: _('ASDFASDF')
        },

        translations: {
            deck: _('Deck'),
            panel_position: _('Panel position'),
            open: _('Open'),
            add_card: _('Add Card'),
            ...PanelPositionTr,
        }
    });

    deck!: Deck;

    #current_view: null | { destroy: () => void } = null;
    #todo_file_monitor: Fs.FileMonitor | null = null;

    constructor (ext: Cronomix) {
        super(ext, 'flashcards');

        this.storage.init_keymap({
            open: () => { this.panel_item.menu.open(); },
        });

        this.set_panel_position(this.storage.read.panel_position.value);
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.load_deck();
    }

    destroy () {
        this.storage.destroy();
        super.destroy();
    }

    load_deck () {
        this.#disable_file_monitor();

        const file_path = this.storage.read.deck.value;
        if (! file_path) { this.show_settings(); return; }

        Fs.create_file(file_path);
        const file = Fs.read_entire_file(file_path);
        if (file == null) { this.show_settings(); return; }

        if (file == '') {
            this.deck = { version: 1, session: 1, cards: [] };
            this.flush_deck();
        } else {
            try {
                this.deck = JSON.parse(file);
            } catch (e) {
                logError(e);
                this.show_settings();
                return;
            }
        }

        this.#enable_file_monitor();
        this.show_main_view();
    }

    flush_deck () {
        const content = JSON.stringify(this.deck, null, 4);
        const path = this.storage.read.deck.value;
        if (path) Fs.write_entire_file(path, content);
    }

    #enable_file_monitor () {
        const file = this.storage.read.deck.value!;
        this.#todo_file_monitor = new Fs.FileMonitor(file, () => this.load_deck());
    }

    #disable_file_monitor () {
        if (this.#todo_file_monitor) {
            this.#todo_file_monitor.destroy();
            this.#todo_file_monitor = null;
        }
    }

    show_main_view () {
        this.#current_view?.destroy();
        const view = new MainView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_editor (card?: Card) {
        this.#current_view?.destroy();
        const view = new CardEditor(this, card);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_exam_view () {
        this.#current_view?.destroy();
        const view = new ExamView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_search_view () {
        // this.#current_view?.destroy();
        // const view = new SearchView(this);
        // this.#current_view = view;
        // this.menu.add_child(view.actor);
    }

    show_settings () {
        this.#current_view?.destroy();
        const view = this.storage.render(() => this.show_main_view());
        this.#current_view = { destroy: () => view.destroy() };
        this.menu.add_child(view);
    }
}

class MainView {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });

        const header = new St.BoxLayout();
        this.actor.add_child(header);

        const add_card_button = new Button({ parent: header, icon: 'cronomix-plus-symbolic', label: _('Add Card') });
        Misc.focus_when_mapped(add_card_button.actor);
        header.add_child(new St.BoxLayout({ x_expand: true }));

        const header_buttons  = new ButtonBox(header);
        const help_button     = header_buttons.add({ icon: 'cronomix-question-symbolic' });
        const search_button   = header_buttons.add({ icon: 'cronomix-search-symbolic' });
        const exam_button     = header_buttons.add({ icon: 'cronomix-exam-symbolic' });
        const settings_button = header_buttons.add({ icon: 'cronomix-wrench-symbolic' });

        add_card_button.subscribe('left_click', () => applet.show_editor());
        help_button.subscribe('left_click', () => show_info_popup(help_button.actor, 'asdfsadf'));
        search_button.subscribe('left_click', () => applet.show_search_view());
        exam_button.subscribe('left_click', () => applet.show_exam_view());
        settings_button.subscribe('left_click', () => applet.show_settings());

        if (applet.deck.cards.length) {
            const card_scroll = new LazyScrollBox(applet.ext.storage.read.lazy_list_page_size.value);
            this.actor.add_child(card_scroll.actor);

            const gen = function * () {
                for (const [,card] of applet.deck.cards.entries()) {
                    yield new CardWidget(applet, card).actor;
                }
            };

            card_scroll.set_children(-1, gen());
        }
    }

    destroy () {
        this.actor.destroy();
    }
}

class CardWidget extends Misc.Card {
    card: Card;

    constructor (applet: FlashcardsApplet, card: Card) {
        super();

        this.card = card;

        const time_label = new St.Label({ text: '#' + card.bucket, y_align: Clutter.ActorAlign.CENTER, style: 'font-weight: bold;' });
        this.left_header_box.add_child(time_label);

        const edit_button   = new Button({ parent: this.autohide_box, icon: 'cronomix-edit-symbolic', style_class: 'cronomix-floating-button' });
        const delete_button = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic', style_class: 'cronomix-floating-button' });

        this.actor.add_child((new Markup(card.question)).actor);

        const answer_dropdown = new Misc.Dropdown(_('Answer'));
        this.actor.add_child(answer_dropdown.actor);
        answer_dropdown.body.add_child((new Markup(card.answer)).actor);

        edit_button.subscribe('left_click', () => applet.show_editor(card));
        delete_button.subscribe('left_click', () => {
            show_confirm_popup(delete_button, () => {
                this.actor.destroy();
                Misc.array_remove(applet.deck.cards, card);
                applet.flush_deck();
            });
        });
    }
}

export class CardEditor {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet, card?: Card) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-flashcard-editor cronomix-spacing' });

        const question_editor = new EditorView();
        this.actor.add_child(question_editor.actor);
        question_editor.main_view.entry_header.insert_child_at_index(new St.Label({ text: _('Question'), y_align: Clutter.ActorAlign.CENTER }), 0);

        const answer_editor = new EditorView();
        this.actor.add_child(answer_editor.actor);
        answer_editor.main_view.entry_header.insert_child_at_index(new St.Label({ text: _('Answer'), y_align: Clutter.ActorAlign.CENTER }), 0);

        const group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        answer_editor.main_view.left_box.add_child(group);

        Misc.focus_when_mapped(question_editor.main_view.entry.entry);

        const bucket_picker = new IntPicker(0, 5, card?.bucket ?? 1);
        new Misc.Row(_('Bucket'), bucket_picker.actor, group);

        const button_box    = new ButtonBox(answer_editor.main_view.left_box);
        const ok_button     = button_box.add({ wide: true, label: _('Ok') });
        const cancel_button = button_box.add({ wide: true, label: _('Cancel') });

        cancel_button.subscribe('left_click', () => applet.show_main_view());
        ok_button.subscribe('left_click', () => {
            if (card) {
                card.bucket   = bucket_picker.get_value();
                card.question = question_editor.main_view.entry.entry.get_text();
                card.answer   = answer_editor.main_view.entry.entry.get_text();
            } else {
                applet.deck.cards.push({
                    bucket:   bucket_picker.get_value(),
                    question: question_editor.main_view.entry.entry.get_text(),
                    answer:   answer_editor.main_view.entry.entry.get_text(),
                });
            }

            applet.flush_deck();
            applet.show_main_view();
        });

        question_editor.main_view.entry.entry.set_text(card?.question ?? '');
        answer_editor.main_view.entry.entry.set_text(card?.answer ?? '');
    }

    destroy () {
        this.actor.destroy();
    }
}

export class ExamView {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });

        const group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        this.actor.add_child(group);

        const session_count_label = new St.Label({ style: "font-weight: bold;", text: '' + applet.deck.session });
        new Misc.Row(_('Session'), session_count_label, group);

        const remaining_cards_label = new St.Label({ style: "font-weight: bold;", text: '0' });
        new Misc.Row(_('Remaining cards'), remaining_cards_label, group);

        const button_box     = new ButtonBox(this.actor);
        const correct_button = button_box.add({ wide: true, label: _('Correct') });
        const wrong_button   = button_box.add({ wide: true, label: _('Wrong') });
        const cancel_button  = button_box.add({ wide: true, label: _('Cancel') });
        correct_button.actor.add_style_class_name('cronomix-green');
        wrong_button.actor.add_style_class_name('cronomix-red');

        const remaining_cards: Card[] = [];
        for (const card of applet.deck.cards) {
            const days = Math.pow(2, card.bucket);
            if ((applet.deck.session % days) === 0) remaining_cards.push(card);
        }

        applet.deck.session++;
        if (applet.deck.session > 32) applet.deck.session = 1;

        let card: CardWidget|null = null;
        const show_next_card = () => {
            card?.actor.destroy();
            remaining_cards_label.text = '' + remaining_cards.length;
            if (remaining_cards.length) {
                card = new CardWidget(applet, remaining_cards.pop()!);
                this.actor.add_child(card.actor);
            } else {
                correct_button.actor.visible = false;
                wrong_button.actor.visible = false;
            }
        };

        show_next_card();

        correct_button.subscribe('left_click', () => {
            if (card) {
                card.card.bucket++;
                if (card.card.bucket > 5) card.card.bucket = 5;
            }
            show_next_card();
        });
        wrong_button.subscribe('left_click', () => {
            if (card) card.card.bucket = 1;
            show_next_card();
        });
        cancel_button.subscribe('left_click', () => {
            applet.flush_deck();
            applet.show_main_view();
        });
    }

    destroy () {
        this.actor.destroy();
    }
}
