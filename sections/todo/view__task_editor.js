const St       = imports.gi.St;
const Gtk      = imports.gi.Gtk;
const Gio      = imports.gi.Gio
const Meta     = imports.gi.Meta;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;
const Lang     = imports.lang;
const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ           = ME.imports.lib.fuzzy_search;
const MULTIL_ENTRY   = ME.imports.lib.multiline_entry;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const TODO_TXT_SYNTAX_URL = 'https://github.com/todotxt/todo.txt';


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ Task Editor UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @task     : obj (optional)
//
// @signals:
//   - 'add-task'    (returns task string)
//   - 'edit-task'   (returns task string)
//   - 'delete-task' (returns bool; if true, the task is to be archived as well)
//   - 'cancel'
//
// If @task is provided, then the entry will be prepopulated with the task_str
// of that task object and the signals 'delete-task' and 'edit-task' will be
// used instead of 'add-task'.
// =====================================================================
var TaskEditor = new Lang.Class({
    Name: 'Timepp.TaskEditor',

    _init: function (ext, delegate, task) {
        this.ext      = ext;
        this.delegate = delegate;

        this.curr_selected_completion   = null;
        this.current_word_start         = 0;
        this.current_word_end           = 0;
        this.text_changed_handler_block = false;


        // One of: 'edit-task', 'add-task'.
        this.mode = task ? 'edit-task' : 'add-task';


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box task-editor' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // entry
        //
        this.entry_container = new St.BoxLayout({ vertical: true, style_class: 'row entry-container' });
        this.content_box.add_child(this.entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Task...'), true, true);
        this.entry_container.add_actor(this.entry.actor);

        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;

        if (this.mode === 'edit-task') {
            this.text_changed_handler_block = true;

            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                this.entry.entry.set_text(task.task_str);
                this.entry._resize_entry();
                this.text_changed_handler_block = false;
            });
        }


        //
        // help label
        //
        {
            this.help_label = new St.Button({ can_focus: true, reactive: true, x_align: St.Align.END, style_class: 'row todo-syntax-link' });
            this.entry_container.insert_child_at_index(this.help_label, 0);
            let label = new St.Label({ text: _('syntax help'), style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
            this.help_label.add_actor(label);
        }


        //
        // used to show project/context completions
        //
        this.completion_menu = new St.ScrollView({ visible: false, style_class: 'vfade' });

        this.completion_menu.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.completion_menu.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.entry_container.add_child(this.completion_menu);

        this.completion_menu_content = new St.BoxLayout({ vertical: true, reactive: true, style_class: 'view-box-content completion-box' });
        this.completion_menu.add_actor(this.completion_menu_content);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add_actor(this.btn_box);

        if (this.mode === 'edit-task') {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            this.btn_box.add(this.button_delete, {expand: true});
            this.button_delete.connect('clicked', () => this.emit('delete-task'));
        }

        let current = this.delegate.settings.get_value('todo-current').deep_unpack();

        if (this.mode === 'edit-task' && current.done_file && !task.hidden) {
            this.button_archive = new St.Button({ can_focus: true, label: _('Archive'), style_class: 'btn-delete button', x_expand: true });
            this.btn_box.add(this.button_archive, {expand: true});
            this.button_archive.connect('clicked', () => this.emit('delete-task', true));
        }

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        this.btn_box.add(this.button_cancel, {expand: true});

        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', () => {
            this.emit(this.mode, this._create_task_str());
        });
        this.button_cancel.connect('clicked', () => {
           this.emit('cancel');
        });
        this.help_label.connect('button-press-event', () => {
            try {
                Gio.app_info_launch_default_for_uri(
                    TODO_TXT_SYNTAX_URL,
                    global.create_app_launch_context(0, -1)
                );
            }
            catch (e) { logError(e); }
        });
        this.entry.entry.clutter_text.connect('text-changed', () => {
            if (this.text_changed_handler_block)
                return Clutter.EVENT_PROPAGATE;

            Mainloop.idle_add(() => {
                let word = this._get_current_word();
                if (word) this._show_completions(word);
                else      this.completion_menu.hide();
            });
        });
        this.entry.entry.connect('key-press-event', (_, event) => {
            let symbol = event.get_key_symbol();

            if (this.completion_menu.visible && symbol === Clutter.Tab) {
                this._on_tab();
                return Clutter.EVENT_STOP;
            }
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (this.completion_menu.visible) this._on_completion_selected();
        });
        this.entry.entry.connect('queue-redraw', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (ext.needs_scrollbar())
                this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.completion_menu_content.connect('queue-redraw', () => {
            this.completion_menu.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (this.ext.needs_scrollbar())
                this.completion_menu.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    // @word: string (a context or project)
    _show_completions: function (word) {
        let completions = null;

        if (word === '(')
            completions = this._find_completions(word, this.delegate.stats.priorities);
        else if (word[0] === '@')
            completions = this._find_completions(word, this.delegate.stats.contexts);
        else if (word[0] === '+')
            completions = this._find_completions(word, this.delegate.stats.projects);

        if (!completions || completions.length === 0) {
            this.completion_menu.hide();
            return;
        }

        this.completion_menu_content.destroy_all_children();
        this.completion_menu.show();

        for (let i = 0; i < completions.length; i++)  {
            let item = new St.Button({ label: completions[i], reactive: true, track_hover: true, x_align: St.Align.START, style_class: 'row popup-menu-item' });
            this.completion_menu_content.add_child(item);

            item.connect('notify::hover', (item) => {
                this._on_completion_hovered(item);
            });
            item.connect('clicked', (item) => {
                this._on_completion_selected();
            });
        }

        this.completion_menu_content.first_child.pseudo_class = 'active';
        this.curr_selected_completion = this.completion_menu_content.first_child;
    },

    // @needle   : string (a context or project)
    // @haystack : map    (of all contexts or projects);
    //
    // If @needle is a context, then the @haystack has to be the map of all
    // contexts. Likewise for projects.
    _find_completions: function (needle, haystack) {
        if (needle === '@' || needle === '+') {
            let res = [];
            for (let [key,] of haystack) res.push(key);
            return res;
        }

        let reduced_results = [];

        let score;

        for (let [keyword,] of haystack) {
            score = FUZZ.fuzzy_search_v1(needle, keyword);
            if (!score) continue;
            reduced_results.push([score, keyword]);
        }

        reduced_results.sort((a, b) => a[0] < b[0]);

        let results = [];

        for (let i = 0, len = reduced_results.length; i < len; i++) {
            results[i] = reduced_results[i][1];
        }

        return results;
    },

    // Get the word that the cursor is currently on or null if the word is not
    // a context/project.
    _get_current_word: function () {
        let text = this.entry.entry.get_text();

        if (! text) return null;

        let len  = text.length;

        if (len === 0) return null;

        let pos = this.entry.entry.clutter_text.cursor_position;

        if (pos === -1) pos = len;

        if (pos === 0 || /\s/.test(text[pos - 1])) return null;

        if (pos === len || /\s/.test(text[pos])) pos--;

        let start = pos;
        while (start > 0 && text[start] !== ' ') start--;

        let end = pos;
        while (end < len && text[end] !== ' ') end++;

        if (text[start] === ' ') start++;
        if (end !== len && text[end] === ' ') end--;

        let word = text.substring(start, end + 1);

        if ((pos === 0 && word === '(') ||
            /[@+]/.test(word) ||
            G.REG_CONTEXT.test(word) ||
            G.REG_PROJ.test(word)) {

            this.current_word_start = start;
            this.current_word_end   = end;

            return word;
        }
        else {
            return null;
        }
    },

    _on_tab: function () {
        this.curr_selected_completion.pseudo_class = '';

        let next = this.curr_selected_completion.get_next_sibling();

        if (next) {
            this.curr_selected_completion = next;
            next.pseudo_class = 'active';
        }
        else {
            this.curr_selected_completion = this.completion_menu_content.first_child;
            this.curr_selected_completion.pseudo_class = 'active';
        }

        SCROLL_TO_ITEM.scroll(this.completion_menu,
                              this.completion_menu_content,
                              this.curr_selected_completion);
    },

    _on_completion_selected: function () {
        this.completion_menu.hide();
        this.text_changed_handler_block = true;

        let completion = this.curr_selected_completion.label;

        let text =
            this.entry.entry.get_text().slice(0, this.current_word_start) +
            completion +
            this.entry.entry.get_text().slice(this.current_word_end + 1);

        this.entry.entry.text = text;

        // @BUG or feature?
        // Setting the cursor pos directly seeems to also select the text, so
        // use this func instead.
        let p = this.current_word_start + completion.length;
        this.entry.entry.clutter_text.set_selection(p, p);

        this.text_changed_handler_block = false;
    },

    _on_completion_hovered: function (item) {
        this.curr_selected_completion.pseudo_class = '';
        this.curr_selected_completion = item;
        item.pseudo_class = 'active';
    },

    _create_task_str: function () {
        if (this.mode === 'edit-task') return this.entry.entry.get_text();

        // If in add mode, we insert a creation date if the user didn't do it.
        let words = this.entry.entry.get_text().split(/ +/);

        if (words[0] === 'x') {
            if (!Date.parse(words[1]))
                words.splice(1, 0, G.date_yyyymmdd(), G.date_yyyymmdd());
            else if (words[2] && !Date.parse(words[2]))
                words.splice(2, 0, G.date_yyyymmdd());
        }
        else if (G.REG_PRIO.test(words[0])) {
            if (words[1] && !Date.parse(words[1]))
                words.splice(1, 0, G.date_yyyymmdd());
        }
        else if (!Date.parse(words[0])) {
            words.splice(0, 0, G.date_yyyymmdd());
        }

        return words.join(' ');
    },
});
Signals.addSignalMethods(TaskEditor.prototype);

