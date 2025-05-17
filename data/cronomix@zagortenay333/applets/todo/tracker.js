import St from 'gi://St';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Task } from './task.js';
import * as Fs from './../../utils/fs.js';
import { ext } from './../../extension.js';
import * as T from './../../utils/time.js';
import * as Pop from './../../utils/popup.js';
import * as Misc from './../../utils/misc.js';
import { Entry } from './../../utils/entry.js';
import { PubSub } from './../../utils/pubsub.js';
import * as P from './../../utils/markup/parser.js';
import { LazyScrollBox } from './../../utils/scroll.js';
import { Markup } from './../../utils/markup/renderer.js';
import { Button, ButtonBox } from './../../utils/button.js';
import { FilePicker, Dropdown } from './../../utils/pickers.js';

export class TrackerStats {
    today = 0;
    week = 0;
    month = 0;
    year = 0;
    custom = {
        since: '',
        until: '',
        total: 0,
        slots: Array(),
    };
}

export const TrackerSort = {
    get asc() { return _('Ascending'); },
    get desc() { return _('Descending'); },
};

export class TrackerQuery {
    filter = '';
    since = '';
    until = '';
    sort = 'asc';
}

export class TimeTracker extends PubSub {
    file = '';
    slots = Array();
    tic = 0; // 0 when paused
    time = new T.Time(0); // 0 when paused
    tracked_slot = null;
    
    #storage_sub = 0;
    #applet;
    
    constructor(applet) {
        super();
        this.#applet = applet;
        this.set_file(applet.storage.read.tracker_file.value);
        this.#storage_sub = applet.storage.subscribe('todo_file', () => this.stop());
    }
    
    destroy() {
        this.#applet.storage.unsubscribe(this.#storage_sub);
        this.#storage_sub = 0;
        this.stop();
    }
    
    set_file(file) {
        if (file === this.file)
            return '';
        
        this.stop();
        this.file = file;
        this.#applet.storage.modify('tracker_file', x => x.value = file);
        
        try {
            const content = Fs.read_entire_file(file);
            this.slots = content ? JSON.parse(content).slots : [];
        }
        catch (e) {
            this.file = '';
            this.#applet.storage.modify('tracker_file', x => x.value = '');
            return '' + e;
        }
        
        let dirty = false;
        
        for (const [idx, slot] of this.slots.entries()) {
            let text = slot.task;
            let ast = new P.Parser(text).parse_blocks().next().value;
            
            if (ast?.tag !== 'AstMeta') {
                text = `[track:${idx}]\n  ` + text.replaceAll('\n', '\n  ');
                ast = new P.Parser(text).parse_blocks().next().value;
                dirty = true;
            }
            
            slot.task = new Task(text, ast);
            slot.task.toJSON = this.#task_to_json;
            
            if (slot.task.ast.config.track !== idx) {
                slot.task.ast.config.track = idx;
                slot.task.serialize_header();
                dirty = true;
            }
        }
        
        if (dirty)
            this.flush();
        return '';
    }
    
    flush() {
        if (!this.file)
            return;
        const content = JSON.stringify({ slots: this.slots }, null, 4);
        Fs.write_entire_file(this.file, content);
    }
    
    start(slot) {
        this.stop();
        this.tracked_slot = slot;
        this.#tic();
        this.#applet.panel_label.show();
        this.#applet.panel_item.add_style_class_name('cronomix-yellow');
        this.publish('start', null);
    }
    
    stop() {
        if (this.tic === 0)
            return;
        GLib.source_remove(this.tic);
        this.tic = 0;
        this.time = new T.Time(0);
        this.flush();
        this.#applet.panel_label.hide();
        this.#applet.panel_item.remove_style_class_name('cronomix-yellow');
        this.publish('stop', null);
    }
    
    is_tracking(task) {
        return (this.tic !== 0) && (this.get_slot(task) === this.tracked_slot);
    }
    
    update_slot(task) {
        const slot = this.get_slot(task);
        if (!slot)
            return;
        slot.task = new Task(task.text, new P.Parser(task.text).parse_blocks().next().value);
        slot.task.toJSON = this.#task_to_json;
        this.flush();
    }
    
    get_slot(task) {
        if (!this.file)
            return null;
        
        const config = task.ast.config;
        let slot = (config.track === undefined) ? null : this.slots[config.track];
        
        if (!slot) {
            config.track = this.slots.length;
            task.serialize_header();
            this.#applet.flush_tasks();
            const slot_task = new Task(task.text, new P.Parser(task.text).parse_blocks().next().value);
            slot_task.toJSON = this.#task_to_json;
            slot = { task: slot_task, time: {} };
            this.slots.push(slot);
            this.flush();
        }
        
        return slot;
    }
    
    #task_to_json() {
        return this.text;
    }
    
    #tic(prev = T.get_time_ms(), count = 0) {
        const date = T.get_iso_date();
        const now = T.get_time_ms();
        const dt = now - prev;
        this.time = new T.Time(this.time.total + dt);
        
        let slot_time = this.tracked_slot.time[date] ?? 0;
        this.tracked_slot.time[date] = Math.round((1000 * slot_time + dt) / 1000);
        
        if (count === 30) {
            count = 0;
            this.flush();
        }
        
        this.tic = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this.#tic(now, count + 1));
        this.#applet.set_panel_label(this.time.fmt_hms());
        this.publish('tic', null);
    }
}

export class TimeTrackerView {
    actor;
    
    #applet;
    #stats;
    
    #tracked_slot_id = 0;
    #tracking_card;
    #tracking_card_title;
    
    #query_filter_entry;
    #query_since_entry;
    #query_until_entry;
    #query_info_button;
    #query_sort;
    #query_markup;
    #custom_date_range_label = '';
    #per_task_query_title;
    #query_tasks_scroll;
    
    constructor(applet, task_to_query) {
        this.#applet = applet;
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'cronomix-spacing' });
        
        const tracker = applet.tracker;
        const saved_query = applet.storage.read.tracker_query.value;
        const filter_format = Fs.read_entire_file(ext.path + '/data/docs/filters') ?? '';
        const tracker_file_format = Fs.read_entire_file(ext.path + '/data/docs/tracker') ?? '';
        const tracker_query_format = Fs.read_entire_file(ext.path + '/data/docs/tracker_query') ?? '';
        const card_title_top_margin = 8;
        
        //
        // left column
        //
        const left_column = new St.BoxLayout({ vertical: true, x_expand: true, style: 'min-width: 256px;', style_class: 'cronomix-spacing' });
        this.actor.add_child(left_column);
        
        //
        // file selection card
        //
        left_column.add_child(new St.Label({ text: _('Time Tracker'), style: 'font-weight: bold;' }));
        
        const file_selection_card = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
        left_column.add_child(file_selection_card);
        
        const fsc_row1 = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        file_selection_card.add_child(fsc_row1);
        
        const fsc_file_picker = new FilePicker({ parent: fsc_row1, hint_text: _('Select time tracker file') });
        fsc_file_picker.entry.text = applet.storage.read.tracker_file.value;
        
        const fsc_info_button = new Button({ parent: fsc_row1, icon: 'cronomix-question-symbolic' });
        
        const fsc_row2 = new ButtonBox(file_selection_card);
        const fsc_close_button = fsc_row2.add({ wide: true, label: _('Close') });
        Misc.focus_when_mapped(fsc_close_button.actor);
        
        //
        // currently tracking card
        //
        this.#tracking_card_title = new St.Label({ text: _('Currently Tracking'), style: `font-weight: bold; margin-top: ${card_title_top_margin}px;` });
        left_column.add_child(this.#tracking_card_title);
        
        this.#tracking_card = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-group' });
        left_column.add_child(this.#tracking_card);
        
        const ctc_preview_button = new Button({ icon: 'cronomix-eye-symbolic' });
        
        const ctc_row1 = new Misc.Row(tracker.time.fmt_hms(), ctc_preview_button.actor, this.#tracking_card);
        const ctc_time_label = ctc_row1.label;
        ctc_time_label.style = 'font-weight: bold';
        ctc_time_label.style_class = 'cronomix-yellow';
        
        const ctc_row2 = new ButtonBox(this.#tracking_card);
        const ctc_stop_button = ctc_row2.add({ wide: true, label: _('Stop') });
        
        //
        // search data card
        //
        left_column.add_child(new St.Label({ text: _('Search Data'), style: `font-weight: bold; margin-top: ${card_title_top_margin}px;` }));
        
        const query_card = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'cronomix-group' });
        left_column.add_child(query_card);
        
        const sdc_filter_row = new St.BoxLayout({ x_expand: true, style_class: 'cronomix-spacing' });
        query_card.add_child(sdc_filter_row);
        
        this.#query_filter_entry = new Entry(_('Filter expression'));
        sdc_filter_row.add_child(this.#query_filter_entry.actor);
        const track = task_to_query?.ast.config.track;
        this.#query_filter_entry.set_text((track !== undefined) ? ('track:' + track) : saved_query.filter);
        
        this.#query_info_button = new Button({ parent: sdc_filter_row, icon: 'cronomix-question-symbolic' });
        
        this.#query_since_entry = new Entry(_('Date (e.g., 2000-01-24)'));
        new Misc.Row(_('Since'), this.#query_since_entry.actor, query_card);
        this.#query_since_entry.set_text(saved_query.since);
        
        this.#query_until_entry = new Entry(_('Date (e.g., 2000-01-24)'));
        new Misc.Row(_('Until'), this.#query_until_entry.actor, query_card);
        this.#query_until_entry.set_text(saved_query.until);
        
        const sdc_button_row = new St.BoxLayout({ x_expand: true, style_class: 'cronomix-spacing' });
        query_card.add_child(sdc_button_row);
        
        this.#query_sort = new Dropdown(saved_query.sort, Object.keys(TrackerSort), Object.values(TrackerSort));
        sdc_button_row.add_child(this.#query_sort.actor.actor);
        
        const sdc_copy_button = new Button({ parent: sdc_button_row, wide: true, label: _('Copy') });
        
        //
        // right column
        //
        const right_column = new St.BoxLayout({ vertical: true, x_expand: true, style: 'min-width: 256px;', style_class: 'cronomix-spacing' });
        this.actor.add_child(right_column);
        
        //
        // totals times table
        //
        right_column.add_child(new St.Label({ text: _('Totals'), style: 'font-weight: bold;' }));
        
        this.#query_markup = new Markup('');
        right_column.add_child(this.#query_markup.actor);
        this.#query_markup.actor.add_style_class_name('floating');
        
        //
        // per slot totals in custom range
        //
        this.#per_task_query_title = new St.Label({ style: `font-weight: bold; margin-top: ${card_title_top_margin}px;` });
        right_column.add_child(this.#per_task_query_title);
        
        this.#query_tasks_scroll = new LazyScrollBox(applet.ext.storage.read.lazy_list_page_size.value);
        right_column.add_child(this.#query_tasks_scroll.actor);
        
        //
        // listen
        //
        fsc_close_button.subscribe('left_click', () => applet.show_main_view());
        fsc_file_picker.on_change = (path) => { tracker.set_file(path ?? ''); this.#update_ui(); };
        fsc_info_button.subscribe('left_click', () => Pop.show_info_popup(fsc_info_button, tracker_file_format));
        this.#query_since_entry.entry.clutter_text.connect('text-changed', () => this.#update_query_column());
        this.#query_until_entry.entry.clutter_text.connect('text-changed', () => this.#update_query_column());
        this.#query_filter_entry.entry.clutter_text.connect('text-changed', () => this.#update_query_column());
        this.#query_info_button.subscribe('left_click', () => Pop.show_info_popup(this.#query_info_button, filter_format));
        ctc_stop_button.subscribe('left_click', () => {
            tracker.stop();
            this.#update_ui();
        });
        ctc_preview_button.subscribe('left_click', () => {
            const msg = '>' + tracker.tracked_slot?.task.text.replaceAll('\n', '\n  ');
            Pop.show_info_popup(ctc_preview_button, msg);
        });
        sdc_copy_button.subscribe('left_click', () => {
            const result = { ...this.#stats };
            result.custom.slots = result.custom.slots.map(x => ({ slot: x.slot.task.text, total: x.total }));
            Misc.copy_to_clipboard(JSON.stringify(result, null, 4));
            const msg = _('Search results copied to clipboard!') + '\n\n' + tracker_query_format;
            Pop.show_info_popup(sdc_copy_button, msg);
        });
        this.#query_sort.on_change = sort => {
            applet.storage.modify('tracker_query', x => x.value.sort = sort);
            this.#update_query_column();
        };
        let counter = 0;
        this.#tracked_slot_id = tracker.subscribe('tic', () => {
            ctc_time_label.text = tracker.time.fmt_hms();
            if (counter++ === 5) {
                counter = 0;
                this.#update_ui();
            }
        });
        
        //
        // finally
        //
        this.#update_ui();
    }
    
    destroy() {
        this.#applet.tracker.unsubscribe(this.#tracked_slot_id);
        this.actor.destroy();
    }
    
    #update_ui() {
        const tracker = this.#applet.tracker;
        this.#tracking_card.visible = !!tracker.tic;
        this.#tracking_card_title.visible = !!tracker.tic;
        this.#update_query_column();
    }
    
    #update_query_column() {
        const tracker = this.#applet.tracker;
        const filter = new P.Parser(this.#query_filter_entry.entry.text || '*').try_parse_filter();
        
        let since;
        let until;
        
        { // Parse dates:
            if (this.#query_since_entry.entry.text) {
                const date = new Date(this.#query_since_entry.entry.text);
                since = Number.isNaN(date.valueOf()) ? '' : T.get_iso_date(date);
            }
            else {
                since = '0000-00-00';
            }
            
            if (this.#query_until_entry.entry.text) {
                const date = new Date(this.#query_until_entry.entry.text);
                until = Number.isNaN(date.valueOf()) ? '' : T.get_iso_date(date);
            }
            else {
                until = '9999-99-99';
            }
        }
        
        { // Check for errors:
            this.#query_since_entry.actor.remove_style_class_name('cronomix-red');
            this.#query_until_entry.actor.remove_style_class_name('cronomix-red');
            this.#query_info_button.set_icon('cronomix-question-symbolic');
            this.#query_info_button.actor.remove_style_class_name('cronomix-red');
            this.#query_filter_entry.actor.remove_style_class_name('cronomix-red');
            
            if (!since) {
                this.#query_since_entry.actor.add_style_class_name('cronomix-red');
                return;
            }
            else if (!until) {
                this.#query_until_entry.actor.add_style_class_name('cronomix-red');
                return;
            }
            else if (!filter) {
                this.#query_info_button.set_icon('cronomix-issue-symbolic');
                this.#query_info_button.actor.add_style_class_name('cronomix-red');
                this.#query_filter_entry.actor.add_style_class_name('cronomix-red');
                return;
            }
        }
        
        // Save query to storage:
        this.#applet.storage.modify('tracker_query', x => x.value = {
            filter: this.#query_filter_entry.entry.text,
            since: this.#query_since_entry.entry.text,
            until: this.#query_until_entry.entry.text,
            sort: x.value.sort // Already updated by the widget's on_change() function.
        });
        
        { // Compute stats:
            const dates = T.get_special_dates();
            this.#stats = new TrackerStats();
            this.#stats.custom.until = until;
            this.#stats.custom.since = since;
            
            for (const slot of tracker.slots) {
                if (!slot.task.satisfies_filter(filter))
                    continue;
                
                let slot_custom_range_total = 0;
                
                for (const [day, time] of Object.entries(slot.time)) {
                    if (day >= since && day <= until) {
                        slot_custom_range_total += time;
                        this.#stats.custom.total += time;
                    }
                    
                    for (const [key, date] of Object.entries(dates)) {
                        if (day >= date && day <= dates.today) {
                            this.#stats[key] += time;
                        }
                    }
                }
                
                if (slot_custom_range_total)
                    this.#stats.custom.slots.push({ slot, total: slot_custom_range_total });
            }
        }
        
        this.#custom_date_range_label =
            (since !== '0000-00-00' && until !== '9999-99-99') ? since + '  ...  ' + until :
                (since !== '0000-00-00') ? _('Since') + ' ' + since :
                    (until !== '9999-99-99') ? _('Until') + ' ' + until :
                        _('All Time');
        
        { // Render total times table:
            let markup = '';
            
            for (const [key, tr] of Object.entries(T.SpecialDatesTr)) {
                const time = this.#stats[key];
                const fmt = new T.Time(time * 1000).fmt_hms();
                markup += `|${tr}\n|${fmt}\n|-\n`;
            }
            
            const custom_total = new T.Time(this.#stats.custom.total * 1000).fmt_hms();
            markup += `|${this.#custom_date_range_label}\n|${custom_total}\n|-\n`;
            
            this.#query_markup.render(markup);
        }
        
        { // Render the per slot totals in custom range:
            const sort = this.#applet.storage.read.tracker_query.value.sort;
            this.#stats.custom.slots.sort((a, b) => (sort === 'asc') ? (a.total - b.total) : (b.total - a.total));
            this.#per_task_query_title.text = _('Per Slot Totals') + ` (${this.#custom_date_range_label})`;
            this.#query_tasks_scroll.actor.visible = true;
            this.#query_tasks_scroll.set_children(-1, this.#gen_task_stats());
        }
    }
    
    *#gen_task_stats() {
        for (const entry of this.#stats.custom.slots) {
            const card = new Misc.Card();
            card.actor.add_style_class_name('cronomix-time-tracker-task-card');
            
            const time_label = new St.Label({ text: new T.Time(entry.total * 1000).fmt_hms(), style: 'font-weight: bold;' });
            card.left_header_box.add_child(time_label);
            
            const copy_button = new Button({ parent: card.header, wide: false, label: _('Copy') });
            copy_button.subscribe('left_click', () => {
                Misc.copy_to_clipboard(entry.slot.task.text);
                Pop.show_info_popup(copy_button, _('Task text copied to clipboard!'));
            });
            
            const txt = entry.slot.task.text;
            const task_label = new St.Label({ text: txt.endsWith('\n') ? txt.substring(0, txt.length - 1) : txt, style_class: 'body' });
            card.actor.add_child(task_label);
            
            yield card.actor;
        }
    }
}
