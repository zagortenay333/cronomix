import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './utils/fs.js';
import { Storage } from './utils/storage.js';
import { Applet } from './applets/applet.js';
import { light_or_dark } from './utils/misc.js';
import { TimerApplet } from './applets/timer.js';
import { AlarmApplet } from './applets/alarm.js';
import { TodoApplet } from './applets/todo/main.js';
import { PomodoroApplet } from './applets/pomodoro.js';
import { StopwatchApplet } from './applets/stopwatch.js';
import { FlashcardsApplet } from './applets/flashcards.js';

//
// To register a new applet:
//
//   1. Import the applet here.
//   2. Add an entry to this map.
//   3. Add an entry to the storage config.
//
export const applets = [
    [ 'todo', TodoApplet ],
    [ 'alarm', AlarmApplet ],
    [ 'timer', TimerApplet ],
    [ 'pomodoro', PomodoroApplet ],
    [ 'stopwatch', StopwatchApplet ],
    [ 'flashcards', FlashcardsApplet ],
] as const;

export class Cronomix {
    storage = new Storage({
        version: 0,
        file: '~/.config/cronomix/global.json',

        values: {
            todo:                { tag: 'boolean', value: true },
            alarm:               { tag: 'boolean', value: true },
            timer:               { tag: 'boolean', value: true },
            pomodoro:            { tag: 'boolean', value: true },
            stopwatch:           { tag: 'boolean', value: true },
            flashcards:          { tag: 'boolean', value: true },
            theme_file:          { tag: 'file',    value: '', start: ext.path + '/data/themes/' },
            lazy_list_page_size: { tag: 'number',  value: 20, range: [1, 100000] },
        },

        groups: [
            ['todo', 'alarm', 'timer', 'pomodoro', 'stopwatch', 'flashcards'],
            ['theme_file', 'lazy_list_page_size'],
        ],

        infos: {
            lazy_list_page_size: _('Number of items shown each time you press "show more" in a scroll list.\nMaking this number very large can cause performance issues.')
        },

        translations: {
            todo: _('Todo'),
            alarm: _('Alarm'),
            timer: _('Timer'),
            pomodoro: _('Pomodoro'),
            stopwatch: _('Stopwatch'),
            flashcards: _('Flashcards'),
            theme_file: _('Theme css (empty for auto selection)'),
            lazy_list_page_size: _('Lazy list page size'),
        }
    });

    enabled_applets = new Map<string, Applet>();

    #stylesheet?: string;
    #theme_change_sig = 0;
    #ignore_next_theme_change_sig = false;

    constructor () {
        this.#load_theme();
        this.#load_applets();
        this.storage.subscribe('theme_file', () => this.#load_theme());
        this.#theme_change_sig = St.ThemeContext.get_for_stage(global.stage).connect('changed', () => this.#load_theme());
    }

    destroy () {
        const theme_context = St.ThemeContext.get_for_stage(global.stage);

        if (this.#theme_change_sig)  {
            theme_context.disconnect(this.#theme_change_sig);
            this.#theme_change_sig = 0;
        }

        if (this.#stylesheet) {
            const existing_theme = theme_context.get_theme();
            if (existing_theme) existing_theme.unload_stylesheet(Fs.file_new_for_path(this.#stylesheet));
        }

        for (const [, applet] of this.enabled_applets) applet.destroy();
        this.storage.destroy();
    }

    #load_applets () {
        let loaded_an_applet = false;

        for (const [applet_name, applet_ctor] of applets) {
            if (this.storage.read[applet_name].value) {
                loaded_an_applet = true;
                const applet = new applet_ctor(this);
                this.enabled_applets.set(applet_name, applet);
            }

            this.storage.subscribe(applet_name, ({ value }) => {
                const applet = this.enabled_applets.get(applet_name);

                if (value && !applet) {
                    const applet = new applet_ctor(this);
                    this.enabled_applets.set(applet_name, applet);
                } else if (!value && applet) {
                    this.enabled_applets.delete(applet_name);
                    applet.destroy();
                }
            });
        }

        // We must load at least one applet or else the user
        // has no way of interacting with the extension...
        if (! loaded_an_applet) {
            const [applet_name] = applets[0];
            this.storage.modify(applet_name, s => s.value = true);
        }
    }

    #load_theme () {
        if (this.#ignore_next_theme_change_sig) return;
        this.#ignore_next_theme_change_sig = true;

        let stylesheet = this.storage.read.theme_file.value;

        // Pick a stylesheet automatically:
        if (! stylesheet) {
            const dummy = new St.Widget({ visible: false, style_class: 'popup-menu-content' });
            global.stage.add_child(dummy);
            const theme_node = dummy.get_theme_node();

            const [ok, col] = theme_node.lookup_color('background-color', false);
            const style     = ok ? light_or_dark(col.red, col.green, col.blue) : 'dark';
            stylesheet      = ext.path + '/data/themes/' + style + '.css';

            dummy.destroy();
        }

        // Set theme:
        try {
            const theme_context  = St.ThemeContext.get_for_stage(global.stage);
            const existing_theme = theme_context.get_theme();

            if (existing_theme) {
                if (this.#stylesheet) existing_theme.unload_stylesheet(Fs.file_new_for_path(this.#stylesheet));
                existing_theme.load_stylesheet(Fs.file_new_for_path(stylesheet));
                theme_context.set_theme(existing_theme);
            } else {
                Main.setThemeStylesheet(stylesheet)
                Main.loadTheme();
            }
        } catch (e) {
            logError(e);
            this.#ignore_next_theme_change_sig = false;
            return;
        }

        { // Load colors:
            const dummy = new St.Widget({ visible: false, style_class: 'cronomix-custom-css' });
            global.stage.add_child(dummy);

            const theme_node = dummy.get_theme_node();

            for (const key of Object.keys(colors)) {
                const [ok, col] = theme_node.lookup_color(key, false);
                if (ok) colors[key] = col.to_string();
            }

            dummy.destroy();
        }

        this.#stylesheet = stylesheet;
        this.#ignore_next_theme_change_sig = false;
    }
}

export const colors: Record<string, string> = {
    ['-cronomix-link-color']:          '#73C2FE',
    ['-cronomix-tag-ref-color']:       '#FFAB42',
    ['-cronomix-markup-raw-fg']:       '#93a1a1',
    ['-cronomix-markup-raw-bg']:       '#002b36',
    ['-cronomix-markup-highlight-fg']: '#000000',
    ['-cronomix-markup-highlight-bg']: '#FFAB42',
};

export var ext: Extension;
export default class E extends Extension {
    cronomix: Cronomix | null = null;
    enable  () { ext = this; this.cronomix = new Cronomix(); }
    disable () { this.cronomix?.destroy(); this.cronomix = null; ext = null!; }
}
