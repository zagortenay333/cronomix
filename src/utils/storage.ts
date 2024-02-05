import * as St from 'gi://St';
import * as GLib from 'gi://GLib';

import * as Fs from './fs.js';
import * as Pop from './popup.js';
import { PubSub } from './pubsub.js';
import { ScrollBox } from './scroll.js';
import { Button, CheckBox } from './button.js';
import { KeyMap, KeyMapPicker } from './keymap.js';
import { FilePicker, IntPicker, Dropdown } from './pickers.js';
import { _, unreachable, Row, focus_when_mapped } from './misc.js';

export type Value =
    | { tag: 'custom';  value: unknown; }
    | { tag: 'boolean'; value: boolean; }
    | { tag: 'keymap';  value: string|null; }
    | { tag: 'enum';    value: string; enum: string[]; }
    | { tag: 'file';    value: string|null; start?: string; }
    | { tag: 'number';  value: number; range: [number, number]; }

export type StorageConfig = {
    file:          string; // File path where the values are stored.
    values:        Record<string, Value>;
    groups?:       string[][]; // For grouping rows in the GUI. Strings are keyof values.
    translations?: Record<string, string>; // For translating strings in the GUI.
}

export class Storage <
    Config extends StorageConfig,
    Values extends Config['values']
> extends PubSub<Values> {
    config: Config;
    keymap: KeyMap|null = null;
    #flush_mainloop_id = 0;

    constructor (config: Config) {
        super();
        this.config = config;
        this.#load_from_disk();
    }

    destroy () {
        this.unsubscribe_all();
        this.keymap?.destroy();

        if (this.#flush_mainloop_id) {
            GLib.source_remove(this.#flush_mainloop_id);
            this.#flush_mainloop_id = 0;
            this.flush();
        }
    }

    get read (): Immutable<Values> {
        return this.config.values as Immutable<Values>;
    }

    modify <Key extends string & keyof Values> (
        key: Key,
        fn: (value: Values[Key]) => void
    ) {
        const value = this.config.values[key] as Values[Key];
        fn(value);
        this.publish(key, value);
        this.schedule_flush();
    }

    flush () {
        const content = JSON.stringify({ values: this.config.values }, null, 4);
        Fs.write_entire_file(this.config.file, content);
    }

    schedule_flush () {
        if (this.#flush_mainloop_id) return;

        this.#flush_mainloop_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.flush();
            this.#flush_mainloop_id = 0;
        });
    }

    init_keymap (callbacks: Record<string, () => void>) {
        if (this.keymap) return;

        this.keymap = new KeyMap();

        for (const [key, value] of Object.entries(this.config.values)) {
            if (value.tag !== 'keymap') continue;
            const callback = callbacks[key];
            if (callback) this.keymap.add(key, value.value, callback);
        }
    }

    #load_from_disk () {
        const file = Fs.read_entire_file(this.config.file);

        if (file) {
            const on_disk: any = JSON.parse(file);

            for (const key of Object.keys(on_disk.values)) {
                if (! this.config.values[key]) delete on_disk.values[key];
            }

            for (const key of Object.keys(this.config.values)) {
                if (! on_disk.values[key]) on_disk.values[key] = this.config.values[key];
            }

            for (const [key, value] of Object.entries(this.config.values)) {
                if (on_disk.values[key].tag !== value.tag) on_disk.values[key] = value;
            }

            this.config.values = on_disk.values;
        }

        this.flush();
    }

    #translate (str: string): string {
        return this.config.translations?.[str] ?? str;
    }

    // If @check returns a non-empty string (an error msg) the user
    // won't be able to commit their changes. When the user commits
    // the changes, @done will be called.
    render (
        done:   (changed: Map<string, Value>) => void,
        check?: (changed: Map<string, Value>) => string
    ): St.Widget {
        const scrollbox = new ScrollBox();
        scrollbox.box.add_style_class_name('cronomix-settings');
        const changed_values = new Map<string, Value>();
        const groups = this.config.groups ?? [Object.keys(this.config.values)];

        for (const group of groups) {
            const rows_box = new St.BoxLayout({ vertical: true, style_class: 'cronomix-group' });
            scrollbox.box.add_actor(rows_box);

            for (const key of group) {
                const value = this.config.values[key];
                if (! value) continue;

                switch (value.tag) {
                case 'boolean': {
                    const checkbox = new CheckBox();
                    checkbox.checked = value.value;
                    checkbox.subscribe('left_click', () => { changed_values.set(key, value); value.value = checkbox.checked; });
                    new Row(this.#translate(key), checkbox.actor, rows_box);
                } break;

                case 'number': {
                    const on_change = (val: number, valid: boolean) => { if (valid) { changed_values.set(key, value); value.value = val; } }
                    const picker = new IntPicker(...value.range, value.value, 0, on_change);
                    new Row(this.#translate(key), picker.actor, rows_box);
                } break;

                case 'keymap': {
                    const picker = new KeyMapPicker(value.value, (new_map) => {
                        changed_values.set(key, value);
                        value.value = new_map;

                        if (this.keymap) {
                            if (new_map) {
                                this.keymap.change_shortcut(key, new_map);
                            } else {
                                this.keymap.disable(key);
                            }
                        }
                    });

                    new Row(this.#translate(key), picker.actor, rows_box);
                } break;

                case 'enum': {
                    const display_values = value.enum.map(x => this.#translate(x));

                    const dropdown = new Dropdown(value.value, value.enum, display_values, new_value => {
                        value.value = new_value;
                        changed_values.set(key, value);
                    });

                    new Row(this.#translate(key), dropdown.actor.actor, rows_box);
                } break;

                case 'file': {
                    const picker = new FilePicker({
                        path: value.value,
                        start: value.start,
                        on_change: (path) => { value.value = path; changed_values.set(key, value); }
                    });

                    new Row(this.#translate(key), picker.actor, rows_box);
                } break;

                case 'custom': break;
                default: unreachable(value);
                }
            }
        }

        //
        // buttons
        //
        const box = new St.BoxLayout({ style_class: 'cronomix-spacing' });
        scrollbox.box.add_actor(box);

        const done_button = new Button({ parent: box, wide: true, label: _('Ok') });
        const info_button = new Button({ parent: box, icon: 'cronomix-question-symbolic' });

        focus_when_mapped(done_button.actor);

        info_button.subscribe('left_click', () => {
            const msg = _('Right click any of the extension panel items to access the global settings.');
            Pop.show_info_popup(info_button, msg);
        });
        done_button.subscribe('left_click', () => {
            const error_msg = check?.(changed_values);

            if (error_msg) {
                Pop.show_error_popup(done_button, error_msg);
            } else {
                done(changed_values);
                this.schedule_flush();
                for (const [key, value] of changed_values) this.publish(key, value as Values[string]);
            }
        });

        return scrollbox.actor;
    }
}
