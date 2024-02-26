import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TodoApplet } from './main.js';
import { compare_tasks } from './sort.js';
import { Task, TaskCard } from './task.js';
import * as Fs from './../../utils/fs.js';
import * as Misc from './../../utils/misc.js';
import { Entry } from './../../utils/entry.js';
import * as P from './../../utils/markup/parser.js';
import { show_info_popup } from './../../utils/popup.js';
import { ScrollBox, LazyScrollBox } from './../../utils/scroll.js';
import { Button, CheckBox, ButtonBox } from './../../utils/button.js';

export class FilterGroup {
    title = '';
    filters = ''; // Comma separated list of filters.
}

export class KanbanView {
    actor: St.BoxLayout;

    #applet: TodoApplet;
    #tracker_id1 = 0;
    #tracker_id2 = 0;

    constructor (applet: TodoApplet) {
        this.#applet = applet;
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-spacing' });

        //
        // Header
        //
        const header = new St.BoxLayout();
        this.actor.add_actor(header);

        const add_task_button = new Button({ parent: header, style_class: 'bg', icon: 'cronomix-plus-symbolic', label: _('Add Task') });
        Misc.focus_when_mapped(add_task_button.actor);

        header.add_actor(new St.Widget({ x_expand: true, style: 'min-width: 20px;' }));

        const button_box      = new ButtonBox(header, false);
        const search_button   = button_box.add({ icon: 'cronomix-search-symbolic' });
        const sort_button     = button_box.add({ icon: 'cronomix-sort-ascending-symbolic' });
        const boards_button   = button_box.add({ icon: 'cronomix-filter-symbolic' });
        const tracker_button  = button_box.add({ icon: 'cronomix-time-tracker-symbolic' });
        const settings_button = button_box.add({ icon: 'cronomix-wrench-symbolic' });

        if (applet.tracker.tic) tracker_button.actor.add_style_class_name('cronomix-yellow');

        //
        // columns
        //
        const columns_scroll = new ScrollBox(false);
        this.actor.add_actor(columns_scroll.actor);
        columns_scroll.actor.visible = applet.tasks.length > 0;

        const current_filter = applet.storage.read.active_filter.value;
        const filters = applet.storage.read.filters.value[current_filter]?.filters?.replaceAll('\n', '')?.split(',');
        const columns = new Array<KanbanColumn>();

        // Make columns:
        for (const filter of filters ?? ['* & !hide']) {
            const filter_node = new P.Parser(filter).try_parse_filter();

            if (filter_node) {
                const column = new KanbanColumn(applet, filter_node, !!filters);
                columns_scroll.box.add_actor(column.actor);
                columns.push(column);
            }
        }

        // Move tasks into corresponding columns:
        for (const task of applet.tasks) {
            for (const column of columns) {
                if (task.satisfies_filter(column.filter)) {
                    column.tasks.push(task);
                    break;
                }
            }
        }

        { // Sort and make task card widgets to the columns:
            const gen = function * (tasks: Task[]) {
                for (const [, task] of tasks.entries()) {
                    const card = new TaskCard(applet, task);
                    yield card.actor;
                }
            };

            const sort = applet.storage.read.sort.value;
            for (const column of columns) {
                column.tasks.sort((a, b) => compare_tasks(sort, a, b));
                column.tasks_scroll.set_children(column.tasks.length, gen(column.tasks));
            }
        }

        sort_button.subscribe('left_click', () => applet.show_sort_view());
        settings_button.subscribe('left_click', () => applet.show_settings());
        search_button.subscribe('left_click', () => applet.show_search_view());
        add_task_button.subscribe('left_click', () => applet.show_task_editor());
        tracker_button.subscribe('left_click', () => applet.show_tracker_view());
        boards_button.subscribe('left_click', () => applet.show_filter_view());
        this.#tracker_id1 = applet.tracker.subscribe('stop', () => tracker_button.actor.remove_style_class_name('cronomix-yellow'));
        this.#tracker_id2 = applet.tracker.subscribe('tic', () => tracker_button.actor.add_style_class_name('cronomix-yellow'));
    }

    destroy () {
        this.#applet.tracker.unsubscribe(this.#tracker_id1);
        this.#applet.tracker.unsubscribe(this.#tracker_id2);
        this.actor.destroy();
    }
}

class KanbanColumn {
    filter: P.AstFilter;
    actor: St.BoxLayout;
    tasks = new Array<Task>();
    tasks_scroll: LazyScrollBox;

    constructor (applet: TodoApplet, filter: P.AstFilter, show_filter_header = true) {
        this.filter = filter;
        this.actor = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-spacing' });

        if (show_filter_header) {
            const header = new St.Label({ y_align: Clutter.ActorAlign.CENTER, text: P.filter_to_string(filter), style: 'min-width: 300px; font-weight: bold;', style_class: 'cronomix-box' });
            this.actor.add_actor(header);
        }

        this.tasks_scroll = new LazyScrollBox(applet.ext.storage.read.lazy_list_page_size.value);
        this.actor.add_actor(this.tasks_scroll.actor);
    }
}

export class FilterView {
    actor: St.BoxLayout;

    #applet: TodoApplet;
    #cards_scroll: ScrollBox;
    #cards = Array<FilterCard>();
    #active_filter?: FilterCard | null;

    constructor (applet: TodoApplet) {
        this.#applet = applet;
        this.actor = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'cronomix-spacing' });

        this.#cards_scroll = new ScrollBox();
        this.actor.add_actor(this.#cards_scroll.actor);
        for (const filter of applet.storage.read.filters.value) this.#add_card(filter);
        this.#cards_scroll.actor.visible = this.#cards_scroll.box.get_n_children() > 0;

        const buttons = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        this.actor.add_actor(buttons);

        const button_box  = new ButtonBox(buttons);
        const button_ok   = button_box.add({ wide: true, label: _('Ok') });
        const button_add  = button_box.add({ wide: true, label: _('Add Filter') });
        const button_help = new Button({ parent: buttons, icon: 'cronomix-question-symbolic' });

        Misc.focus_when_mapped(this.#cards_scroll.actor.visible ? button_ok.actor : button_add.actor);

        const help_msg =
            _('## Filter Groups') + '\n\n' +
            _('Each filter in a group creates a column of tasks in the main view.') + '\n' +
            _('If no group is selected, a group with 1 ``* & !hide`` filter is created.') + '\n' +
            _('Tasks go into the first column from the left whose filter they pass.') + '\n' +
            _('Hidden tasks only pass filters of the form ``hide`` or ``hide & expr``.') + '\n' +
            Fs.read_entire_file(Misc.ext().path + '/data/docs/filters') ?? '';

        button_add.subscribe('left_click', () => this.#add_card(new FilterGroup()));
        button_help.subscribe('left_click', () => show_info_popup(button_help, help_msg));
        button_ok.subscribe('left_click', () => { this.#store_filters(); applet.show_main_view(); });
    }

    destroy () {
        this.actor.destroy();
    }

    #store_filters () {
        let active_filter = -1;
        const filters = new Array<FilterGroup>();

        for (const [idx, card] of this.#cards.entries()) {
            if (card.checkbox.checked) active_filter = idx;
            filters.push({ title: card.title.entry.text, filters: card.filters.entry.text })
        }

        this.#applet.storage.modify('filters', x => x.value = filters);
        this.#applet.storage.modify('active_filter', x => x.value = active_filter);
    }

    #add_card (group: Immutable<FilterGroup>) {
        const card = new FilterCard(group);
        this.#cards_scroll.box.add_actor(card.actor);
        this.#cards_scroll.actor.visible = true;
        this.#cards.push(card);
        this.#check(card);

        if (this.#applet.storage.read.active_filter.value === this.#cards.length - 1) {
            this.#active_filter = card;
            card.checkbox.checked = true;
        }

        card.filters.entry.clutter_text.connect('text-changed', () => {
            this.#check(card);
        });
        card.delete_button.subscribe('left_click', () => {
            Misc.array_remove(this.#cards, card);
            card.actor.destroy();
            this.#cards_scroll.actor.visible = this.#cards_scroll.box.get_n_children() > 0;
        });
        card.checkbox.subscribe('left_click', () => {
            if (card.checkbox.checked) {
                if (this.#active_filter) this.#active_filter.checkbox.checked = false;
                this.#active_filter = card;
            } else {
                this.#active_filter = null;
            }
        });
    }

    #check (card: FilterCard) {
        const filters = card.filters.entry.text.replaceAll('\n', '').split(',');

        for (const filter of filters) {
            const parser = new P.Parser(filter);

            if (parser.try_parse_filter()) {
                card.filters.actor.remove_style_class_name('cronomix-red');
            } else {
                card.filters.actor.add_style_class_name('cronomix-red');
                break;
            }
        }
    }
}

class FilterCard extends Misc.Card {
    title: Entry;
    filters: Entry;
    checkbox: CheckBox;
    delete_button: Button;

    constructor (filter: Immutable<FilterGroup>) {
        super();

        this.checkbox = new CheckBox({ parent: this.left_header_box });
        this.delete_button = new Button({ parent: this.autohide_box, icon: 'cronomix-trash-symbolic', style_class: 'cronomix-floating-button' });

        this.title = new Entry(_('Title'));
        this.actor.add_actor(this.title.actor);
        this.title.set_text(filter.title);

        this.filters = new Entry(_('Comma separated list of filters.'));
        this.actor.add_actor(this.filters.actor);
        this.filters.set_text(filter.filters);
    }
}
