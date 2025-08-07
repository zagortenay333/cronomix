import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './../utils/fs.js';
import { ext } from './../extension.js';
import * as Misc from './../utils/misc.js';
import { Entry } from './../utils/entry.js';
import { Cronomix } from './../extension.js';
import { Storage } from './../utils/storage.js';
import { ScrollBox } from './../utils/scroll.js';
import { LazyScrollBox } from './../utils/scroll.js';
import { Markup } from './../utils/markup/renderer.js';
import { EditorView } from './../utils/markup/editor.js';
import { FilePicker, IntPicker } from './../utils/pickers.js';
import { Button, ButtonBox, CheckBox } from './../utils/button.js';
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

export type DeckPath = {
    active: boolean;
    path: string;
}

export class FlashcardsApplet extends Applet {
    storage = new Storage({
        version: 0,
        file: '~/.config/cronomix/flashcards.json',

        values: {
            panel_position: { tag: 'enum',   value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            open:           { tag: 'keymap', value: null },
            add_card:       { tag: 'keymap', value: null },
            change_deck:    { tag: 'keymap', value: null },
            start_exam:     { tag: 'keymap', value: null },
            search_cards:   { tag: 'keymap', value: null },
            decks:          { tag: 'custom', value: []/*of DeckPath*/ },
        },

        groups: [
            ['panel_position'],
            ['open', 'add_card', 'change_deck', 'start_exam', 'search_cards'],
        ],

        translations: {
            panel_position: _('Panel position'),
            open: _('Open'),
            add_card: _('Add card'),
            change_deck: _('Change deck'),
            start_exam: _('Start exam'),
            search_cards: _('Search cards'),
            ...PanelPositionTr,
        }
    });

    deck!: Deck;

    #current_view: null | { destroy: () => void } = null;
    #todo_file_monitor: Fs.FileMonitor | null = null;

    constructor (extension: Cronomix) {
        super(extension, 'flashcards');

        this.storage.init_keymap({
            open:         () => { this.panel_item.menu.open(); },
            add_card:     () => { this.panel_item.menu.open(); if (! (this.#current_view instanceof CardEditor)) this.show_editor(); },
            change_deck:  () => { this.panel_item.menu.open(); this.show_deck_view(); },
            start_exam:   () => { this.panel_item.menu.open(); this.show_exam_view(); },
            search_cards: () => { this.panel_item.menu.open(); this.show_search_view(); },
        });

        this.set_panel_position(this.storage.read.panel_position.value);
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.load_deck();
    }

    destroy () {
        this.storage.destroy();
        super.destroy();
    }

    #get_active_file_path (): string | null {
        for (const p of this.storage.read.decks.value) {
            if ((p as DeckPath).active) return (p as DeckPath).path;
        }

        return null;
    }

    load_deck () {
        this.#disable_file_monitor();

        const file_path = this.#get_active_file_path();
        if (file_path === null) { this.show_deck_view(); return; }

        Fs.create_file(file_path);
        const file = Fs.read_entire_file(file_path);
        if (file == null) { this.show_deck_view(); return; }

        if (file.trim() === '') {
            this.deck = { version: 1, session: 1, cards: [] };
            this.flush_deck();
        } else {
            try {
                this.deck = JSON.parse(file);
            } catch (e) {
                logError(e);
                this.show_deck_view();
                return;
            }
        }

        this.#enable_file_monitor();
        this.show_main_view();
    }

    flush_deck () {
        const content = JSON.stringify(this.deck, null, 4);
        const path = this.#get_active_file_path();
        if (path) Fs.write_entire_file(path, content);
    }

    #enable_file_monitor () {
        const path = this.#get_active_file_path();
        if (path) {
            this.#todo_file_monitor = new Fs.FileMonitor(path, () => this.load_deck());
        }
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

    show_search_view () {
        this.#current_view?.destroy();
        const view = new SearchView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }

    show_deck_view () {
        this.#current_view?.destroy();
        const view = new DeckView(this);
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

    show_settings () {
        this.#current_view?.destroy();
        const view = this.storage.render((c) => c.get('deck') ?? this.show_main_view());
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
        const decks_button    = header_buttons.add({ icon: 'cronomix-folder-symbolic' });
        const exam_button     = header_buttons.add({ icon: 'cronomix-exam-symbolic' });
        const settings_button = header_buttons.add({ icon: 'cronomix-wrench-symbolic' });

        add_card_button.subscribe('left_click', () => applet.show_editor());
        help_button.subscribe('left_click', () => show_info_popup(help_button, Fs.read_entire_file(ext.path + '/data/docs/flashcards') ?? ''));
        search_button.subscribe('left_click', () => applet.show_search_view());
        decks_button.subscribe('left_click', () => applet.show_deck_view());
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
        switch (card.bucket) {
        case 0: time_label.text += ' (' + _('every session') + ')'; break;
        case 1: time_label.text += ' (' + _('every 2 sessions') + ')'; break;
        case 2: time_label.text += ' (' + _('every 4 sessions') + ')'; break;
        case 3: time_label.text += ' (' + _('every 8 sessions') + ')'; break;
        case 4: time_label.text += ' (' + _('every 16 sessions') + ')'; break;
        case 5: time_label.text += ' (' + _('every 32 sessions') + ')'; break;
        }

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

        const bucket_picker = new IntPicker(0, 5, card?.bucket ?? 0);
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

        const session_count = new IntPicker(1, 32, applet.deck.session);
        new Misc.Row(_('Session'), session_count.actor, group);

        const remaining_cards_label = new St.Label({ style: "font-weight: bold;", text: '0' });
        new Misc.Row(_('Remaining cards'), remaining_cards_label, group);

        const button_box     = new ButtonBox(this.actor);
        const correct_button = button_box.add({ wide: true, label: _('Correct') });
        const wrong_button   = button_box.add({ wide: true, label: _('Wrong') });
        const close_button   = button_box.add({ wide: true, label: _('Close') });
        correct_button.actor.add_style_class_name('cronomix-green');
        wrong_button.actor.add_style_class_name('cronomix-red');

        //
        // show next card
        //
        const remaining_cards: Card[] = [];
        let card: CardWidget|null = null;

        const collect_cards = () => {
            remaining_cards.length = 0;

            for (const card of applet.deck.cards) {
                const days = Math.pow(2, card.bucket);
                const session = applet.deck.session;
                if ((session % days) === 0) remaining_cards.push(card);
            }

            remaining_cards.reverse();
        }

        const show_next_card = () => {
            card?.actor.destroy();
            card = null;
            remaining_cards_label.text = '' + remaining_cards.length;

            if (remaining_cards.length) {
                card = new CardWidget(applet, remaining_cards.pop()!);
                card_scrollbox.box.add_child(card.actor);
                card.autohide_box.visible = false;
                card_scrollbox.actor.visible = true;
                correct_button.actor.visible = true;
                wrong_button.actor.visible   = true;
            } else {
                card_scrollbox.actor.visible = false;
                correct_button.actor.visible = false;
                wrong_button.actor.visible   = false;
            }
        };

        const card_scrollbox = new ScrollBox();
        this.actor.add_child(card_scrollbox.actor);

        collect_cards();
        show_next_card();

        //
        // listen
        //
        session_count.on_change = (val: number, valid: boolean) => {
            if (valid) applet.deck.session = val;
            collect_cards();
            show_next_card();
        };
        correct_button.subscribe('left_click', () => {
            if (card) {
                card.card.bucket++;
                if (card.card.bucket > 5) card.card.bucket = 5;
            }
            show_next_card();
        });
        wrong_button.subscribe('left_click', () => {
            if (card) card.card.bucket = 0;
            show_next_card();
        });
        close_button.subscribe('left_click', () => {
            applet.deck.session++;
            if (applet.deck.session > 32) applet.deck.session = 1;
            applet.flush_deck();
        });
    }

    destroy () {
        this.actor.destroy();
    }
}

export class SearchView {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet) {
        this.actor = new St.BoxLayout({ vertical: false, style_class: 'cronomix-spacing' });

        //
        // left box
        //
        const left_box = new ScrollBox(false);
        this.actor.add_child(left_box.actor);
        left_box.box.vertical = true;

        //
        // entry
        //
        const entry_group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        left_box.box.add_child(entry_group);

        const entry = new Entry(_('Search cards'));
        entry_group.add_child(entry.actor);
        entry.actor.style = 'min-width: 256px;';
        Misc.focus_when_mapped(entry.entry);

        const fuzzy_search_check = new CheckBox();
        new Misc.Row(_('Do fuzzy search'), fuzzy_search_check.actor, entry_group);

        const bucket_restriction = new IntPicker(-1, 5, -1);
        new Misc.Row(_('Search in bucket (-1 for all buckets)'), bucket_restriction.actor, entry_group);

        //
        // bulk edit options
        //
        const bem_group = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        left_box.box.add_child(bem_group);

        const bucket_picker = new IntPicker(-1, 5, -1);
        new Misc.Row(_('Move cards to bucket (-1 for no move)'), bucket_picker.actor, bem_group);

        const delete_cards_check = new CheckBox();
        const delete_cards_check_row = new Misc.Row(_('Delete selected cards'), delete_cards_check.actor, bem_group);
        delete_cards_check_row.actor.add_style_class_name('cronomix-red');

        const bem_buttons      = new ButtonBox(left_box.box);
        const bem_apply_button = bem_buttons.add({ wide: true, label: _('Apply') });
        const bem_close_button = bem_buttons.add({ wide: true, label: _('Close') });

        //
        // tasks container
        //
        const card_scroll = new LazyScrollBox(applet.ext.storage.read.lazy_list_page_size.value);
        this.actor.add_child(card_scroll.actor);
        card_scroll.box.style = 'min-width: 256px;';

        //
        // Search
        //
        const cards_to_show: { score:number, card:Card }[] = [];

        const search_cards = () => {
            card_scroll.box.remove_all_children();
            cards_to_show.length = 0;

            const needle = entry.entry.text;
            const bucket = bucket_restriction.get_value();

            if (fuzzy_search_check.checked) {
                for (const card of applet.deck.cards) {
                    if ((bucket !== -1) && (card.bucket !== bucket)) continue;

                    const q = Misc.fuzzy_search(needle, card.question);
                    const a = Misc.fuzzy_search(needle, card.answer);

                    if (q == null && a == null) {
                        continue;
                    } else if (q != null && a != null) {
                        cards_to_show.push({ score: Math.max(q, a), card: card });
                    } else if (q == null) {
                        cards_to_show.push({ score: a!, card: card });
                    } else {
                        cards_to_show.push({ score: q!, card: card });
                    }
                }

                cards_to_show.sort((a, b) => (a.score < b.score) ? 1 : 0);
            } else {
                for (const card of applet.deck.cards) {
                    if ((bucket !== -1) && (card.bucket !== bucket)) {
                        continue;
                    } else if ((card.question.indexOf(needle) !== -1) || (card.answer.indexOf(needle) !== -1)) {
                        cards_to_show.push({ score:0, card:card });
                    }
                }
            }

            const gen = function * () {
                for (const {card} of cards_to_show) {
                    yield new CardWidget(applet, card).actor;
                }
            };

            card_scroll.set_children(-1, gen());
        };

        let flush_needed = false;

        //
        // listen
        //
        bucket_restriction.on_change = () => search_cards();
        entry.entry.clutter_text.connect('text-changed', () => search_cards());
        fuzzy_search_check.subscribe('left_click', () => search_cards());
        bem_close_button.subscribe('left_click', () => {
            if (flush_needed) applet.flush_deck();
            applet.show_main_view();
        });
        bem_apply_button.subscribe('left_click', () => {
            show_confirm_popup(bem_apply_button, () => {
                if (delete_cards_check.checked) {
                    for (const {card} of cards_to_show) Misc.array_remove(applet.deck.cards, card);
                    flush_needed = true;
                } else {
                    const move_to_bucket = bucket_picker.get_value();
                    if (move_to_bucket !== -1) {
                        for (const {card} of cards_to_show) card.bucket = move_to_bucket;
                        flush_needed = true;
                    }
                }
                search_cards();
            });
        });

        search_cards();
    }

    destroy () {
        this.actor.destroy();
    }
}

export class DeckView {
    actor: St.BoxLayout;

    constructor (applet: FlashcardsApplet) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });

        const entry = new Entry(_('Search decks'));
        this.actor.add_child(entry.actor);
        Misc.focus_when_mapped(entry.entry);

        const button_row = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        this.actor.add_child(button_row);

        const linked_buttons = new ButtonBox(button_row);
        const ok_button      = linked_buttons.add({ wide: true, label: _('Ok') });
        const add_button     = linked_buttons.add({ wide: true, label: _('Add Deck') });

        const help_button = new Button({ parent: button_row, icon: 'cronomix-question-symbolic' });

        const deck_scroll = new ScrollBox();
        this.actor.add_child(deck_scroll.actor);

        //
        // search
        //
        const decks_to_show: { score:number, path:DeckPath }[] = [];

        const search_decks = () => {
            deck_scroll.box.remove_all_children();
            decks_to_show.length = 0;

            const needle = entry.entry.text;

            for (const path of applet.storage.read.decks.value) {
                const score = Misc.fuzzy_search(needle, (path as DeckPath).path);
                if (score !== null) decks_to_show.push({ score, path });
            }

            decks_to_show.sort((a, b) => (a.score < b.score) ? 1 : 0);

            for (const {path} of decks_to_show) {
                const w = new DeckViewCard(applet, path);

                if (path.active) {
                    deck_scroll.box.insert_child_at_index(w.actor, 0);
                } else {
                    deck_scroll.box.add_child(w.actor);
                }
            }
        };

        search_decks();

        //
        // listen
        //
        help_button.subscribe('left_click', () => {
            let help_text = "[note] " + _('You can select the first deck by pressing ``Ctrl`` + ``Enter``.');
            help_text    += "\n" + (Fs.read_entire_file(ext.path + '/data/docs/flashcards_deck') ?? '');
            show_info_popup(help_button, help_text);
        });
        entry.entry.clutter_text.connect('text-changed', () => search_decks());
        entry.entry.connect('key-release-event', (_:unknown, e: Clutter.Event) => {
            const s = e.get_key_symbol();
            if (decks_to_show.length && e.has_control_modifier() && ((s === Clutter.KEY_Return) || (s === Clutter.KEY_KP_Enter))) {
                applet.storage.modify('decks', (v) => {
                    const first = decks_to_show[0].path;
                    first.active = true;
                    for (const p of v.value) if (p !== first) (p as DeckPath).active = false;
                });
                applet.load_deck();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        ok_button.subscribe('left_click', () => {
            let found_active = false;
            for (const p of applet.storage.read.decks.value) {
                if ((p as DeckPath).active) {
                    found_active = true;
                    break;
                }
            }

            if (!found_active && applet.storage.read.decks.value.length) {
                applet.storage.modify('decks', (v) => (v.value as DeckPath[])[0].active = true);
            }

            applet.load_deck();
        });
        add_button.subscribe('left_click', () => {
            applet.panel_item.menu.close();

            Fs.open_file_dialog(false, null, (path: string) => {
                applet.panel_item.menu.open();
                const deck_path = {active:false, path:path};
                applet.storage.modify('decks', (v) => (v.value as DeckPath[]).push(deck_path));
                search_decks();
            });
        });
    }

    destroy () {
        this.actor.destroy();
    }
}

export class DeckViewCard extends Misc.Card {
    constructor (applet: FlashcardsApplet, path: DeckPath) {
        super();

        const checkbox = new CheckBox({ checked: path.active });
        this.left_header_box.add_child(checkbox.actor);

        const delete_button = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic', style_class: 'cronomix-floating-button' });
        const file_picker = new FilePicker({ parent: this.actor, path: path.path });

        file_picker.on_change = (p) => {
            applet.storage.modify('decks', () => path.path = p ?? '');
        };
        checkbox.subscribe('left_click', () => {
            applet.storage.modify('decks', (v) => {
                path.active = true;
                for (const p of v.value) if (p !== path) (p as DeckPath).active = false;
            });
            applet.load_deck();
        });
        delete_button.subscribe('left_click', () => {
            show_confirm_popup(delete_button, () => {
                applet.storage.modify('decks', (v) => Misc.array_remove(v.value, path));
                this.actor.destroy();
            });
        });
    }
}
