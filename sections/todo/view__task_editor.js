const St       = imports.gi.St;
const Gtk      = imports.gi.Gtk;
const Gio      = imports.gi.Gio
const Meta     = imports.gi.Meta;
const Shell    = imports.gi.Shell;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const TASK         = ME.imports.sections.todo.task_item;

const REG          = ME.imports.lib.regex;
const FUZZ         = ME.imports.lib.fuzzy_search;
const RESIZE       = ME.imports.lib.resize;
const MISC_UTILS   = ME.imports.lib.misc_utils;
const SIG_MANAGER  = ME.imports.lib.signal_manager;
const MULTIL_ENTRY = ME.imports.lib.multiline_entry;


const G = ME.imports.sections.todo.GLOBAL;


const TODO_TXT_SYNTAX_URL = 'https://github.com/zagortenay333/timepp__gnome#todotxt-syntax';


const EditorMode = {
    ADD_TASK  : "ADD_TASK",
    EDIT_TASK : "EDIT_TASK",
};


// =====================================================================
// @@@ ViewTaskEditor
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @task     : obj (optional)
//
// @signals:
//   - 'add-task'    (returns a new task)
//   - 'edited-task' (the task has been edited)
//   - 'delete-task' (returns bool; if true, the task is to be archived as well)
//   - 'cancel'
//
// If @task is provided, then the entry will be prepopulated with the task_str
// of that task object and the signals 'delete-task' and 'edit-task' will be
// used instead of 'add-task'.
// =====================================================================
var ViewTaskEditor = class ViewTaskEditor {
    constructor (ext, delegate, task) {
        this.ext      = ext;
        this.delegate = delegate;

        Mainloop.idle_add(() => this.delegate.actor.add_style_class_name('view-task-editor'));

        this.sigm = new SIG_MANAGER.SignalManager();

        this.curr_selected_completion   = null;
        this.current_word_start         = 0;
        this.current_word_end           = 0;
        this.text_changed_handler_block = false;


        this.mode = task ? EditorMode.EDIT_TASK : EditorMode.ADD_TASK;
        this.old_task_str = "";


        //
        // container
        //
        this.actor = new St.BoxLayout({ style_class: 'view-box' });

        this.content_box = new St.BoxLayout({ vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // preview task
        //
        this.preview_scrollview = new St.ScrollView();
        this.actor.add_actor(this.preview_scrollview);
        this.preview_scrollview.visible = this.delegate.settings.get_boolean('todo-show-task-editor-preview');

        this.preview_scrollbox = new St.BoxLayout({ vertical: true });
        this.preview_scrollview.add_actor(this.preview_scrollbox);

        if (this.mode === EditorMode.ADD_TASK) {
            this.preview_task = new TASK.TaskItem(this.ext, this.delegate, task ? task.task_str : " ", true);
        } else {
            if (task.actor_parent) task.actor_parent.remove_child(task.actor);
            this.preview_task = task;
            this.old_task_str = task.task_str;
        }

        this.preview_task.actor_parent = this.preview_scrollbox;
        this.preview_scrollbox.add_child(this.preview_task.actor);


        //
        // entry
        //
        this.entry_container = new St.BoxLayout({ vertical: true, style_class: 'row' });
        this.content_box.add_child(this.entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Task...'), true);
        this.entry_container.add_actor(this.entry.actor);
        this.entry.automatic_newline_insert = false;
        this.entry.keep_min_height          = false;
        this.entry.resize_with_keyboard     = true;

        this.entry.entry.set_size(400, 64);

        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;

        if (this.mode === EditorMode.EDIT_TASK)
            this.entry.set_text(task.task_str.replace(/\\n/g, '\n'));

        this.entry_resize = new RESIZE.MakeResizable(this.entry.entry);


        //
        // icons
        //
        let header = new St.BoxLayout();
        this.entry_container.insert_child_at_index(header, 0);

        { // help icon
            let box = new St.BoxLayout({ style_class: 'icon-box' });
            header.add_child(box);
            this.help_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-question-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            box.add_child(this.help_icon);
        }

        { // other icons
            let box = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'icon-box-group' });
            header.add_child(box);

            // group 1
            let icon_group = new St.BoxLayout({ style_class: 'icon-box' });
            box.add_child(icon_group);
            this.header_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-header-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.header_icon);
            this.mark_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-mark-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.mark_icon);

            // group 2
            icon_group = new St.BoxLayout({ style_class: 'icon-box' });
            box.add_child(icon_group);
            this.bold_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-bold-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.bold_icon);
            this.italic_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-italic-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.italic_icon);
            this.strike_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-strike-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.strike_icon);
            this.underscore_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-underscore-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.underscore_icon);

            // group 3
            icon_group = new St.BoxLayout({ style_class: 'icon-box' });
            box.add_child(icon_group);
            this.link_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-link-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.link_icon);
            this.code_icon = new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-code-symbolic'), can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.code_icon);

            // group 4
            icon_group = new St.BoxLayout({ style_class: 'icon-box' });
            box.add_child(icon_group);
            this.eye_icon = new St.Icon({ can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER, });
            icon_group.add_child(this.eye_icon);
            if (this.preview_scrollview.visible) this.eye_icon.gicon = MISC_UTILS.getIcon('timepp-eye-symbolic');
            else                                 this.eye_icon.gicon = MISC_UTILS.getIcon('timepp-eye-closed-symbolic')
        }


        //
        // competion menu
        //
        this.completion_menu = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.NEVER, visible: false, style_class: 'vfade' });
        this.entry_container.add_child(this.completion_menu);

        this.completion_menu_content = new St.BoxLayout({ vertical: true, reactive: true, style_class: 'completion-box' });
        this.completion_menu.add_actor(this.completion_menu_content);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add_actor(this.btn_box);

        if (this.mode === EditorMode.EDIT_TASK) {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            this.btn_box.add(this.button_delete, {expand: true});
            this.button_delete.connect('clicked', () => this.emit('delete-task'));
        }

        let current = this.delegate.get_current_todo_file();

        if (this.mode === EditorMode.EDIT_TASK && current && current.done_file && !task.hidden) {
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
        this.preview_task_sid = this.preview_task.actor.connect('captured-event', (_, event) => {
            // We can't use the 'captured-event' sig to prevent actors from
            // getting focused via the keyboard...
            if (event.type() === Clutter.EventType.KEY_RELEASE) this.actor.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        this.content_box.connect('allocation-changed', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
            this.preview_scrollview.vscrollbar_policy = Gtk.PolicyType.NEVER;
            this.preview_scrollview.hscrollbar_policy = Gtk.PolicyType.NEVER;

            let [, nat_h] = this.ext.menu.actor.get_preferred_height(-1);
            let [, nat_w] = this.ext.menu.actor.get_preferred_width(-1);
            let max_h     = this.ext.menu_max_h;
            let max_w     = this.ext.menu_max_w;

            if (nat_w >= max_w) this.preview_scrollview.hscrollbar_policy = Gtk.PolicyType.ALWAYS;

            if (nat_h >= max_h) {
                this.preview_scrollview.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
                this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            }
        });
        this.entry.entry.connect('key-press-event', (_, event) => {
            let symbol = event.get_key_symbol();
            if (this.completion_menu.visible && symbol === Clutter.Tab) {
                this._on_tab();
                return Clutter.EVENT_STOP;
            }
        });
        Mainloop.idle_add(() => { // Connect with a slight delay to avoid some initial confusion.
            this.entry.entry.clutter_text.connect('text-changed', () => {
                // In idle_add because the cursor_position will not be reported correctly.
                Mainloop.idle_add(() => this._on_text_changed());
            });
        });
        this.sigm.connect_release(this.help_icon, Clutter.BUTTON_PRIMARY, true, () => MISC_UTILS.open_web_uri(TODO_TXT_SYNTAX_URL));
        this.sigm.connect_release(this.header_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('#'));
        this.sigm.connect_release(this.mark_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('***'));
        this.sigm.connect_release(this.bold_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('*'));
        this.sigm.connect_release(this.italic_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('__'));
        this.sigm.connect_release(this.strike_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('~~'));
        this.sigm.connect_release(this.underscore_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('___'));
        this.sigm.connect_release(this.link_icon, Clutter.BUTTON_PRIMARY, true, () => this._find_file());
        this.sigm.connect_release(this.code_icon, Clutter.BUTTON_PRIMARY, true, () => this._insert_markdown('``'));
        this.sigm.connect_release(this.eye_icon, Clutter.BUTTON_PRIMARY, true, () => this._toggle_preview());
        this.entry.entry.clutter_text.connect('activate', () => this._on_activate());
        this.button_ok.connect('clicked', () => this._emit_ok());
        this.button_cancel.connect('clicked', () => this._emit_cancel());
        this.actor.connect('key-press-event', (_, event) => {
            switch (event.get_key_symbol()) {
              case Clutter.KEY_KP_Enter:
              case Clutter.Return:
                if (event.get_state() === Clutter.ModifierType.CONTROL_MASK) this._emit_ok();
                break;
              case Clutter.KEY_f:
                if (event.get_state() === Clutter.ModifierType.CONTROL_MASK) this._find_file();
                break;
            }
        });
    }

    _on_text_changed () {
        if (this.text_changed_handler_block) return Clutter.EVENT_PROPAGATE;

        let text = this.entry.entry.get_text();
        this.preview_task.reset(true, text || " ", false)

        let [word, start, end] = this._get_current_word();

        if (word && /[@+]/.test(word[0])) {
            this._show_completions(word);
            this.current_word_start = start;
            this.current_word_end   = end;
        } else {
            this.completion_menu.hide();
        }
    }

    _on_tab () {
        this.curr_selected_completion.pseudo_class = '';
        let next = this.curr_selected_completion.get_next_sibling();

        if (next) {
            this.curr_selected_completion = next;
            next.pseudo_class = 'active';
        } else {
            this.curr_selected_completion = this.completion_menu_content.first_child;
            this.curr_selected_completion.pseudo_class = 'active';
        }

        MISC_UTILS.scroll_to_item(this.completion_menu, this.completion_menu_content, this.curr_selected_completion);
    }

    _on_activate () {
        if (!this.completion_menu.visible || !this.curr_selected_completion) {
            this.entry.insert_text('\n');
            return;
        }

        this.text_changed_handler_block = true;
        let completion = this.curr_selected_completion.label;

        this.entry.entry.text =
            this.entry.entry.get_text().slice(0, this.current_word_start) +
            completion + ' ' +
            this.entry.entry.get_text().slice(this.current_word_end + 1);

        let text = this.entry.entry.get_text();
        this.preview_task.reset(true, text || " ", false)

        // @BUG or feature?
        // Setting the cursor pos directly seeems to also select the text, so
        // use set_selection instead.
        let p = this.current_word_start + completion.length + 1;
        this.entry.entry.clutter_text.set_selection(p, p);

        this.curr_selected_completion = null;
        this.completion_menu.hide();
        this.text_changed_handler_block = false;
    }

    _on_completion_hovered (item) {
        // It seems that when the completion menu gets hidden, the items are
        // moving for a brief moment which triggers the hover callback.
        // We prevent any possible issues in this case by just checking whether
        // the menu is visible.
        if (! this.completion_menu.visible) return;

        this.curr_selected_completion.pseudo_class = '';
        this.curr_selected_completion = item;
        item.pseudo_class = 'active';
    }

    _emit_cancel () {
        if (this.mode === EditorMode.EDIT_TASK)
            this.preview_task.reset(true, this.old_task_str, false)

        this.emit('cancel');
    }

    _emit_ok () {
        if (this.done) return;

        let text = this._create_task_str();
        if (! text) return;

        this.done = true;

        let r = this.preview_task;
        this.preview_task.actor.disconnect(this.preview_task_sid);
        this.preview_scrollbox.remove_child(this.preview_task.actor);
        this.preview_task.actor_parent = null;
        this.preview_task = null;

        r.task_str = text;

        if (this.mode === EditorMode.ADD_TASK) this.emit('add-task', r);
        else                                   this.emit('edited-task');
    }

    _insert_markdown (delim) {
        let text  = this.entry.entry.get_text();
        let pos   = this.entry.entry.clutter_text.get_cursor_position();
        let bound = this.entry.entry.clutter_text.get_selection_bound();

        if (pos === -1)   pos   = text.length;
        if (bound === -1) bound = text.length;

        let word;
        let end;
        let start;

        if (bound === pos) { // nothing selected so wrap current word
            [word, start, end] = this._get_current_word();
        } else {
            word = this.entry.entry.clutter_text.get_selection() + "";

            if (bound < pos) {
                start = bound;
                end   = pos;
            } else {
                start = pos;
                end   = bound;
            }

            if (end > 0) end--;
        }

        this.entry.entry.text = text.slice(0, start) + delim + word + delim + text.slice(end + 1);

        let l = delim.length;
        if (bound === pos) this.entry.entry.clutter_text.set_selection(pos + l, pos + l);
        else               this.entry.entry.clutter_text.set_selection(start + l, end + l + 1);
    }

    _toggle_preview () {
        let state = !this.delegate.settings.get_boolean('todo-show-task-editor-preview');

        if (state) this.eye_icon.gicon = MISC_UTILS.getIcon('timepp-eye-symbolic');
        else       this.eye_icon.gicon = MISC_UTILS.getIcon('timepp-eye-closed-symbolic')

        this.preview_scrollview.visible = state;
        this.delegate.settings.set_boolean('todo-show-task-editor-preview', state);
    }

    _find_file () {
        this.ext.menu.close();
        this.file_chooser = MISC_UTILS.open_file_dialog(false, (out) => {
            if (out) this.entry.insert_text(out);
            this.todo_file_chooser_proc = null;
            this.ext.menu.open();
            Mainloop.idle_add(() => this.entry.entry.grab_key_focus());
        });
    }

    // @word: string (a context or project)
    _show_completions (word) {
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

        for (let i = 0; i < completions.length; i++) {
            let item = new St.Button({ label: completions[i], reactive: true, track_hover: true, x_align: St.Align.START, style_class: 'row popup-menu-item' });
            this.completion_menu_content.add_child(item);

            item.connect('notify::hover', (item) => this._on_completion_hovered(item));
            item.connect('clicked', (item) => this._on_completion_selected());
        }

        this.completion_menu_content.first_child.pseudo_class = 'active';
        this.curr_selected_completion = this.completion_menu_content.first_child;
    }

    // @needle   : string (a context or project)
    // @haystack : map    (of all contexts or projects);
    //
    // If @needle is a context, then the @haystack has to be the map of all
    // contexts. Likewise for projects.
    _find_completions (needle, haystack) {
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
    }

    _get_current_word () {
        let text = this.entry.entry.get_text();
        let len  = text.length;

        let pos = this.entry.entry.clutter_text.get_cursor_position();
        if (pos === -1) pos = len;

        let start = pos - 1;
        let end   = pos;

        while (start > -1 && !/\s/.test(text[start])) start--;
        while (end < len && !/\s/.test(text[end]))    end++;

        start++;
        if (end > 0) end--;

        return [text.substring(start, end + 1), start, end];
    }

    _create_task_str () {
        let text = this.entry.entry.get_text();
        if (! text) return "";

        let words = text.split(' ');
        if (this.mode === EditorMode.EDIT_TASK) return text.replace(/\n/g, '\\n');

        // If in add mode, we insert a creation date if the user didn't do it.
        if (words[0] === 'x') {
            if (!Date.parse(words[1]))
                words.splice(1, 0, MISC_UTILS.date_yyyymmdd(), MISC_UTILS.date_yyyymmdd());
            else if (words[2] && !Date.parse(words[2]))
                words.splice(2, 0, MISC_UTILS.date_yyyymmdd());
        }
        else if (REG.TODO_PRIO.test(words[0])) {
            if (words[1] && !Date.parse(words[1]))
                words.splice(1, 0, MISC_UTILS.date_yyyymmdd());
        }
        else if (!Date.parse(words[0])) {
            words.splice(0, 0, MISC_UTILS.date_yyyymmdd());
        }

        return words.join(' ').replace(/\n/g, '\\n');
    }

    close () {
        if (this.file_chooser_proc) this.file_chooser_proc.force_exit();

        if (this.preview_task) {
            this.preview_task.actor.disconnect(this.preview_task_sid);
            this.preview_scrollbox.remove_child(this.preview_task.actor);
            this.preview_task.actor_parent = null;
            this.preview_task = null;
        }

        Mainloop.timeout_add(0, () => {
            this.actor.destroy();
            this.delegate.actor.remove_style_class_name('view-task-editor');
        });
    }
}
Signals.addSignalMethods(ViewTaskEditor.prototype);
