import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Fs from './../../utils/fs.js';
import { ext } from './../../extension.js';
import { Task, TaskCard } from './task.js';
import { Row } from './../../utils/misc.js';
import * as Pop from './../../utils/popup.js';
import * as Misc from './../../utils/misc.js';
import { Entry } from './../../utils/entry.js';
import * as P from './../../utils/markup/parser.js';
import { FilePicker } from './../../utils/pickers.js';
import { show_info_popup } from './../../utils/popup.js';
import { Button, CheckBox } from './../../utils/button.js';
import { ScrollBox, LazyScrollBox } from './../../utils/scroll.js';

export class SearchView {
    actor;
    entry;
    
    #filtered_tasks = Array();
    
    constructor(applet, query = '') {
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'cronomix-spacing' });
        
        const filter_docs = Fs.read_entire_file(ext.path + '/data/docs/filters') ?? '';
        const tasks_docs = Fs.read_entire_file(ext.path + '/data/docs/todo_tasks') ?? '';
        
        //
        // left box
        //
        const left_box = new ScrollBox(false);
        this.actor.add_child(left_box.actor);
        left_box.box.vertical = true;
        
        //
        // entry
        //
        const entry_box = new St.BoxLayout({ vertical: true, style_class: 'cronomix-headered-entry' });
        left_box.box.add_child(entry_box);
        
        const header = new St.BoxLayout({ style: 'min-width: 256px;', style_class: 'header' });
        entry_box.add_child(header);
        
        const close_button = new Button({ parent: header, icon: 'cronomix-close-symbolic' });
        header.add_child(new St.Widget({ x_expand: true }));
        const help_button = new Button({ parent: header, icon: 'cronomix-question-symbolic' });
        
        this.entry = new Entry(_('Filter expression'));
        entry_box.add_child(this.entry.actor);
        Misc.focus_when_mapped(this.entry.entry);
        
        //
        // tasks container
        //
        const tasks_scroll = new LazyScrollBox(applet.ext.storage.read.lazy_list_page_size.value);
        left_box.box.add_child(tasks_scroll.actor);
        
        //
        // bulk edit menu
        //
        const bulk_edit_menu = new St.BoxLayout({ vertical: true, style_class: 'cronomix-spacing' });
        this.actor.add_child(bulk_edit_menu);
        
        const bem_card0 = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        bulk_edit_menu.add_child(bem_card0);
        
        const bem_delete_checkbox = new CheckBox();
        const del_row = new Row(_('Delete selected tasks'), bem_delete_checkbox.actor, bem_card0);
        
        del_row.label.style = 'font-weight: bold;';
        del_row.label.style_class = 'cronomix-red';
        
        const bem_card1 = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        bulk_edit_menu.add_child(bem_card1);
        
        const bem_export_picker = new FilePicker();
        new Row(_('Copy selected tasks to file'), bem_export_picker.actor, bem_card1);
        
        const bem_card2 = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        bulk_edit_menu.add_child(bem_card2);
        
        const bem_card_info_button = new Button({ icon: 'cronomix-question-symbolic' });
        new Row(_('Modify attributes of selected tasks'), bem_card_info_button.actor, bem_card2);
        
        const bem_del_attributes_entry = new Entry(_('Space separated list of task attributes'));
        new Row(_('Delete'), bem_del_attributes_entry.actor, bem_card2);
        
        const bem_add_attributes_entry = new Entry(_('Space separated list of task attributes'));
        new Row(_('Add'), bem_add_attributes_entry.actor, bem_card2);
        
        const bem_apply_button = new Button({ parent: bulk_edit_menu, wide: true, label: _('Apply') });
        
        const apply_edits = () => {
            if (bem_export_picker.path) {
                let content = '';
                for (const task of this.#filtered_tasks)
                    content += task.text;
                Fs.write_entire_file(bem_export_picker.path, content);
            }
            
            if (bem_delete_checkbox.checked) {
                for (const task of this.#filtered_tasks) {
                    Misc.array_remove(applet.tasks, task);
                    if (applet.tracker.is_tracking(task))
                        applet.tracker.stop();
                }
            }
            else {
                const txt = '[' + bem_del_attributes_entry.entry.text + ']\n' + '[' + bem_add_attributes_entry.entry.text + ']';
                const ast = [...new P.Parser(txt).parse_blocks()];
                const del = ast[0].config;
                const add = ast[1].config;
                
                for (const task of this.#filtered_tasks) {
                    const conf = task.ast.config;
                    
                    if (del.priority === conf.priority)
                        delete conf.priority;
                    if (del.track === conf.track)
                        delete conf.track;
                    if (del.due === conf.due)
                        delete conf.due;
                    if (del.pin)
                        delete conf.pin;
                    if (del.done)
                        delete conf.done;
                    if (del.hide)
                        delete conf.hide;
                    if (del.tags)
                        for (const tag of del.tags)
                            conf.tags?.delete(tag);
                    
                    if (add.priority)
                        conf.priority = add.priority;
                    if (add.track)
                        conf.track = add.track;
                    if (add.due)
                        conf.due = add.due;
                    if (add.pin)
                        conf.pin = add.pin;
                    if (add.done)
                        conf.done = add.done;
                    if (add.hide)
                        conf.hide = add.hide;
                    if (add.tags) {
                        conf.tags ??= new Set();
                        for (const tag of add.tags)
                            conf.tags.add(tag);
                    }
                    
                    task.serialize_header();
                    applet.tracker.update_slot(task);
                }
            }
            
            applet.flush_tasks();
            applet.show_search_view(this.entry.entry.text);
        };
        
        //
        // listen
        //
        bem_apply_button.subscribe('left_click', () => Pop.show_confirm_popup(bem_apply_button, () => apply_edits()));
        bem_card_info_button.subscribe('left_click', () => Pop.show_info_popup(bem_card_info_button, tasks_docs));
        close_button.subscribe('left_click', () => applet.show_main_view());
        help_button.subscribe('left_click', () => show_info_popup(help_button, filter_docs));
        this.entry.entry.clutter_text.connect('text-changed', () => {
            const parser = new P.Parser(this.entry.entry.text || '* & !hide');
            const filter = parser.try_parse_filter();
            
            if (filter) {
                this.#filtered_tasks = [];
                for (const task of applet.tasks)
                    if (task.satisfies_filter(filter))
                        this.#filtered_tasks.push(task);
                
                const lazy_gen = function* (tasks) { for (const task of tasks)
                    yield new TaskCard(applet, task).actor; };
                tasks_scroll.set_children(-1, lazy_gen(this.#filtered_tasks));
                
                help_button.actor.remove_style_class_name('cronomix-red');
                help_button.set_icon('cronomix-question-symbolic');
                this.entry.entry.remove_style_class_name('cronomix-red');
            }
            else {
                help_button.actor.add_style_class_name('cronomix-red');
                help_button.set_icon('cronomix-issue-symbolic');
                this.entry.entry.add_style_class_name('cronomix-red');
            }
        });
        
        //
        // finally
        //
        if (query instanceof Task) {
            const card = new TaskCard(applet, query);
            const gen = function* () { yield card.actor; };
            tasks_scroll.set_children(-1, gen());
            this.#filtered_tasks = [query];
            bem_delete_checkbox.checked = true;
        }
        else {
            this.entry.set_text(' '); // To trigger a change in case initial_query is ''.
            this.entry.set_text(query);
        }
    }
    
    destroy() {
        this.actor.destroy();
    }
}
