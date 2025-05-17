import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SearchView } from './search.js';
import * as Fs from './../../utils/fs.js';
import { Task, TaskEditor } from './task.js';
import { SortView } from './sort.js';
import { Storage } from './../../utils/storage.js';
import * as P from './../../utils/markup/parser.js';
import { FilterView, KanbanView } from './filter.js';
import { Applet, PanelPosition, PanelPositionTr } from './../applet.js';
import { TimeTracker, TimeTrackerView, TrackerQuery } from './tracker.js';

export class TodoApplet extends Applet {
    storage = new Storage({
        file: '~/.config/cronomix/todo.json',
        
        values: {
            panel_position: { tag: 'enum', value: PanelPosition.RIGHT, enum: Object.values(PanelPosition) },
            open: { tag: 'keymap', value: null },
            add_task: { tag: 'keymap', value: null },
            search: { tag: 'keymap', value: null },
            open_tracker: { tag: 'keymap', value: null },
            open_todo_file: { tag: 'keymap', value: null },
            todo_file: { tag: 'file', value: null },
            active_filter: { tag: 'custom', value: -1 },
            filters: { tag: 'custom', value: Array() },
            tracker_file: { tag: 'custom', value: '' },
            tracker_query: { tag: 'custom', value: new TrackerQuery() },
            sort: {
                tag: 'custom',
                value: [
                    { by: 'pin', direction: 'desc' },
                    { by: 'priority', direction: 'asc' },
                    { by: 'due', direction: 'asc' },
                    { by: 'done', direction: 'asc' },
                    { by: 'hide', direction: 'asc' },
                ]
            }
        },
        
        groups: [
            ['todo_file', 'panel_position'],
            ['open', 'add_task', 'search', 'open_tracker', 'open_todo_file'],
        ],
        
        translations: {
            panel_position: _('Panel position'),
            open: _('Open'),
            add_task: _('Add task'),
            search: _('Search tasks'),
            todo_file: _('Todo file'),
            open_tracker: _('Open time tracker'),
            open_todo_file: _('Open todo file'),
            pin: _('Pin'),
            priority: _('Priority'),
            due: _('Due'),
            done: _('Done'),
            hide: _('Hide'),
            asc: _('Ascending'),
            desc: _('Descending'),
            ...PanelPositionTr,
        }
    });
    
    // These data structures maintain state about
    // the current todo file. If you edit tasks
    // that belong to the current todo file, you
    // must update these structures. You should
    // eventually call flush_tasks().
    //
    // The non_tasks array contains top level nodes
    // from the todo file that are not AstMeta. They
    // don't represent tasks, but we keep them in.
    //
    // If you edit a task that is currently being
    // tracked, you can employ different strategies:
    //
    //   1. You can update the corresponding tracker slot
    //      using the update_slot() function.
    //   2. You can stop the tracker. The next time the
    //      user starts tracking the edited task a dialog
    //      will be shown asking them to update the slot.
    tracker;
    tasks = new Array();
    non_tasks = new Array();
    
    #current_view = null;
    #todo_file_monitor = null;
    
    constructor(ext) {
        super(ext, 'todo');
        
        this.storage.init_keymap({
            open: () => { this.panel_item.menu.open(); },
            search: () => { this.panel_item.menu.open(); this.show_search_view(); },
            add_task: () => { this.panel_item.menu.open(); this.show_task_editor(); },
            open_tracker: () => { this.panel_item.menu.open(); this.show_tracker_view(); },
            open_todo_file: () => { Fs.open_file_in_default_app(this.storage.read.todo_file.value ?? ''); },
        });
        
        this.tracker = new TimeTracker(this);
        this.set_panel_position(this.storage.read.panel_position.value);
        this.storage.subscribe('todo_file', () => this.load_tasks());
        this.storage.subscribe('panel_position', ({ value }) => this.set_panel_position(value));
        this.load_tasks();
    }
    
    destroy() {
        this.#disable_file_monitor();
        this.tracker.destroy();
        this.storage.destroy();
        super.destroy();
    }
    
    load_tasks() {
        this.tracker.stop();
        this.tasks.length = 0;
        this.non_tasks.length = 0;
        this.#disable_file_monitor();
        
        const file = this.storage.read.todo_file.value;
        if (!file) {
            this.show_settings();
            return;
        }
        
        Fs.create_file(file);
        this.#enable_file_monitor();
        
        const markup = Fs.read_entire_file(file);
        if (markup === null) {
            this.show_settings();
            return;
        }
        
        const parser = new P.Parser(markup);
        for (const [block_text, block_ast] of parser.parse_blocks_split()) {
            if (block_ast.tag === 'AstMeta') {
                this.tasks.push(new Task(block_text, block_ast));
            }
            else {
                this.non_tasks.push(block_text);
            }
        }
        
        this.show_main_view();
    }
    
    flush_tasks() {
        let content = '';
        
        for (const task of this.tasks) {
            content += task.text;
            if (!task.text.endsWith('\n\n'))
                content += task.text.endsWith('\n') ? '\n' : '\n\n';
        }
        
        for (const non_task of this.non_tasks)
            content += non_task;
        
        if (content.endsWith('\n\n'))
            content = content.substring(0, content.length - 1);
        
        this.#disable_file_monitor();
        const file = this.storage.read.todo_file.value;
        Fs.write_entire_file(file, content || '\n');
        this.#enable_file_monitor();
    }
    
    #enable_file_monitor() {
        const file = this.storage.read.todo_file.value;
        this.#todo_file_monitor = new Fs.FileMonitor(file, () => this.load_tasks());
    }
    
    #disable_file_monitor() {
        if (this.#todo_file_monitor) {
            this.#todo_file_monitor.destroy();
            this.#todo_file_monitor = null;
        }
    }
    
    show_main_view() {
        this.#current_view?.destroy();
        const view = new KanbanView(this);
        this.menu.add_child(view.actor);
        this.#current_view = view;
    }
    
    show_task_editor(task) {
        this.#current_view?.destroy();
        const view = new TaskEditor(this, task ?? undefined);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_search_view(query) {
        this.#current_view?.destroy();
        const view = new SearchView(this, query);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_sort_view() {
        this.#current_view?.destroy();
        const view = new SortView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_filter_view() {
        this.#current_view?.destroy();
        const view = new FilterView(this);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_tracker_view(task_to_query) {
        this.#current_view?.destroy();
        const view = new TimeTrackerView(this, task_to_query);
        this.#current_view = view;
        this.menu.add_child(view.actor);
    }
    
    show_settings() {
        this.#current_view?.destroy();
        
        const msg = _('You must select a todo file.') + '\n' +
            _('A todo file is a text file containing markup.') + '\n' +
            _('To learn about the markup, open the built-in editor and press F1.');
        
        const view = this.storage.render((c) => c.get('todo_file') ?? this.show_main_view(), () => this.storage.read.todo_file.value ? '' : msg);
        
        this.#current_view = view;
        this.menu.add_child(view);
    }
}
