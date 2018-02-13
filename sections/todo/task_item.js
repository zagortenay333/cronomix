const St       = imports.gi.St;
const Gio      = imports.gi.Gio
const Meta     = imports.gi.Meta;
const GLib     = imports.gi.GLib;
const Pango    = imports.gi.Pango;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;
const CheckBox = imports.ui.checkBox;
const Lang     = imports.lang;
const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MISC_UTILS = ME.imports.lib.misc_utils;
const REG        = ME.imports.lib.regex;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ Task item/object including the actor to be drawn in the popup menu.
//
// @ext         : obj (main extension object)
// @delegate    : obj (main section object)
// @task_str    : string (a single line in todo.txt file)
// @self_update : bool
//
// If @self_update is true, the task object will call some funcs
// which might cause it to update it's task_str which will require
// that the task is written to the todo.txt file.
// E.g., the recurrence extension might cause the task_str to change,
// or the defer extension.
// Setting this param to false is useful when we don't intend to update
// the todo.txt file but must in case a task recurs. (E.g., when we load
// tasks from the todo.txt file.)
// =====================================================================
var TaskItem = new Lang.Class({
    Name: 'Timepp.TaskItem',

    _init: function (ext, delegate, task_str, self_update = true) {
        this.ext      = ext;
        this.delegate = delegate;
        this.task_str = task_str;


        this.custom_css = this.ext.custom_css;


        // @NOTE
        // If a var needs to be resettable, add it to the reset() method
        // instead of the _init() method.

        // Project/context/url below mouse pointer, null if none of those.
        this.current_keyword = null;


        //
        // container
        //
        this.actor = new St.Bin({ reactive: true, style: 'width: ' + this.delegate.settings.get_int('todo-task-width') + 'px;', x_fill: true, style_class: 'task-item' });

        this.task_item_content = new St.BoxLayout({ vertical: true, style_class: 'task-item-content' });
        this.actor.add_actor(this.task_item_content);


        //
        // header
        //
        this.header = new St.BoxLayout({ style_class: 'task-item-header' });
        this.task_item_content.add_actor(this.header);


        //
        // checkbox
        //
        this.completion_checkbox = new St.Button({ style_class: 'check-box', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.header.add_child(this.completion_checkbox);

        let checkmark = new St.Bin();
        this.completion_checkbox.add_actor(checkmark);


        //
        // priority label
        //
        this.prio_label = new St.Label({ visible: false, reactive: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'priority-label' });
        this.header.add_child(this.prio_label);


        //
        // body
        //
        this.msg = new St.Label({ reactive: true, y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'description-label'});
        this.task_item_content.add_child(this.msg);

        if (! task_str) this.msg.hide();

        this.msg.clutter_text.line_wrap      = true;
        this.msg.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
        this.msg.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;


        //
        // init the remaining vars and parse task string
        //
        this.reset(self_update);


        //
        // listen
        //
        this.actor.connect('queue-redraw', () => {
            if (this.delegate.tasks_scroll.vscrollbar_visible ||
                ! this.delegate.tasks_scroll_wrapper.visible) {

                return;
            }

            MISC_UTILS.resize_label(this.msg);
        });
        this.actor.connect('event', (actor, event) => {
            this._on_event(actor, event);
            return Clutter.EVENT_PROPAGATE;
        });
        this.prio_label.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.prio_label.connect('enter-event', () => {
            global.screen.set_cursor(Meta.Cursor.POINTING_HAND);
        });
        this.msg.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.msg.connect('motion-event', (_, event) => {
            this.current_keyword = this._find_keyword(event);
            if (this.current_keyword)
                global.screen.set_cursor(Meta.Cursor.POINTING_HAND);
            else
                global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.completion_checkbox.connect('clicked', () => {
            this.toggle_task();
            this.delegate.add_task_button.grab_key_focus();
            this.delegate.on_tasks_changed();
            this.delegate.write_tasks_to_file();
        });
    },

    reset: function (self_update, task_str) {
        if (task_str) {
            this.delegate.time_tracker.update_record_name(this.task_str, task_str);
            this.task_str = task_str;
        }

        // We create these on demand.
        if (this.base_date_labels) this.base_date_labels.destroy();
        if (this.ext_date_labels)  this.ext_date_labels.destroy();
        this.base_date_labels = null; // St.Label for creation/completion dates
        this.ext_date_labels  = null; // St.Label for todo.txt extension dates

        // For sorting purposes, we set the prio to '(_)' when there is no prio.
        this.priority                    = '(_)';
        this.projects                    = [];
        this.contexts                    = [];
        // For sorting purposes, we set the dates to this when they don't exist.
        this.creation_date               = '0000-00-00';
        this.completion_date             = '0000-00-00';
        this.due_date                    = '9999-99-99';
        this.prio_label.visible          = false;
        this.prio_label.text             = '';
        this.actor.style_class           = 'task-item';
        this.completed                   = false;
        this.completion_checkbox.checked = false;
        this.completion_checkbox.visible = true;
        this.tracker_id                  = '';

        if (this.hidden) {
            this.header.remove_child(this.header.get_child_at_index(0));
        }
        this.hidden = false;

        this.defer_date  = '';
        this.is_deferred = false;

        // The recurrence type is one of: 1, 2, 3
        // The numbers just match the global regex TODO_REC_EXT_[123]
        this.rec_type = 1;
        this.rec_str  = '';
        this.rec_next = '';

        // These vars are only used for sorting purposes. They hold the first
        // context/project keyword as they appear in the task_str. If there are
        // no contexts/projects, they are ''.
        // They are set by the _parse_task_str() func.
        this.first_context = '';
        this.first_project = '';

        // These vars are used by the update_body_markup() func to make it
        // possible to update the context/project/url colors without having to
        // re-parse the whole task_str.
        // They are set by the _parse_task_str() func.
        // this.description_markup is an array of marked up words that make up
        // the 'description' part of the task_str sans any extensions.
        // E.g., ['<span foreground="blue">@asdf</span>', ...].
        this.description_markup = null;
        this.context_indices    = [];
        this.project_indices    = [];
        this.link_indices       = [];

        this._parse_task_str();

        if (self_update) {
            this.check_recurrence();
            this.check_deferred_tasks();
            this.update_dates_markup();
        }
    },

    _parse_task_str: function () {
        // The 'header' is part of the task_str at the start that includes
        // the 'x' (checked) sign, the priority, and the completion/creation
        // dates.
        // The 'description' is everything else.

        let words    = MISC_UTILS.split_on_whitespace(this.task_str);
        let len      = words.length;
        let desc_pos = 0; // idx of first word of 'description' in words arr


        //
        // Parse 'header'
        //
        if (words[0] === 'x') {
            this.completed                   = true;
            this.completion_checkbox.checked = true;
            this.actor.add_style_class_name('completed');

            if (len >= 1 & REG.ISO_DATE.test(words[1]) && Date.parse(words[1])) {
                this.completion_date     = words[1];

                if (len >= 2 && REG.ISO_DATE.test(words[2]) && Date.parse(words[2])) {
                    this.creation_date       = words[2];
                    desc_pos                 = 3;
                }
                else desc_pos = 2;
            }
            else desc_pos = 1;
        }
        else if (REG.TODO_PRIO.test(words[0])) {
            this.actor.add_style_class_name(words[0][1]);
            this.prio_label.visible = true;
            this.prio_label.text    = words[0];
            this.priority           = words[0];

            if (len >= 1 && REG.ISO_DATE.test(words[1]) && Date.parse(words[1])) {
                this.creation_date       = words[1];
                desc_pos                 = 2;
            }
            else desc_pos = 1;
        }
        else if (REG.ISO_DATE.test(words[0]) && Date.parse(words[0])) {
            this.creation_date       = words[0];
            desc_pos                 = 1;
        }


        //
        // Parse 'description'
        //
        words = words.slice(desc_pos, len);
        len = words.length;
        let word;

        for (let i = 0; i < len; i++) {
            word = words[i];

            if (REG.TODO_CONTEXT.test(word)) {
                this.context_indices.push(i);
                if (this.contexts.indexOf(word) === -1) {
                    this.contexts.push(word);
                }
                words[i] =
                    '<span foreground="' +
                    this.custom_css['-timepp-context-color'][0] +
                    '"><b>' + word + '</b></span>';
            }
            else if (REG.TODO_PROJ.test(word)) {
                this.project_indices.push(i);
                if (this.projects.indexOf(word) === -1) {
                    this.projects.push(word);
                }
                words[i] =
                    '<span foreground="' +
                    this.custom_css['-timepp-project-color'][0] +
                    '"><b>' + word + '</b></span>';
            }
            else if (REG.URL.test(word) || REG.FILE_PATH.test(word)) {
                this.link_indices.push(i);
                words[i] =
                    '<span foreground="' +
                    this.custom_css['-timepp-link-color'][0] +
                    '"><u><b>' + word + '</b></u></span>';
            }
            else if (REG.TODO_EXT.test(word)) {
                if (this.hidden) {
                    // Ignore all other extensions if task is hidden.
                    continue;
                }
                else if (REG.TODO_HIDE_EXT.test(word)) {
                    this.completion_checkbox.hide();
                    this.prio_label.hide();

                    this.creation_date   = '0000-00-00';
                    this.completion_date = '0000-00-00';
                    this.due_date        = '9999-99-99';
                    this.defer_date      = '';
                    this.is_deferred     = false;
                    this.rec_str         = '';
                    this.tracker_id      = '';
                    this.priority        = '(_)';
                    this.hidden          = true;
                    this.completed       = false;

                    this.actor.add_style_class_name('hidden-task');
                    let icon_incognito_bin = new St.Button({ can_focus: true });
                    this.header.insert_child_at_index(icon_incognito_bin, 0);
                    icon_incognito_bin.add_actor(new St.Icon({ icon_name: 'timepp-hidden-symbolic' }));

                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_DEFER_EXT.test(word)) {
                    if (this.rec_str) continue;

                    this.defer_date = word.slice(word.indexOf(':') + 1);
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_DUE_EXT.test(word)) {
                    if (this.rec_str) continue;

                    this.due_date = word.slice(4);
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_1.test(word)) {
                    if (this.due_date !== '9999-99-99' ||
                        this.creation_date === '0000-00-00')
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 1;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_2.test(word)) {
                    if (this.due_date !== '9999-99-99' ||
                        (this.completed && this.completion_date === '0000-00-00'))
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 2;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_3.test(word)) {
                    if (this.due_date !== '9999-99-99' ||
                        this.creation_date === '0000-00-00')
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 3;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_TRACKER_ID_EXT.test(word)) {
                    this.tracker_id = word.slice(11);
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_PRIO_EXT.test(word)) {
                    words.splice(i, 1); i--; len--;
                }
            }
        }

        if (this.contexts.length > 0) this.first_context = this.contexts[0];
        if (this.projects.length > 0) this.first_project = this.projects[0];

        this.description_markup = words;

        words = MISC_UTILS.markup_to_pango(words.join(' '), this.ext.markup_map);

        words = words.replace(/&(?!amp;|quot;|apos;|lt;|gt;)/g, '&amp;')
                     .replace(/<(?!\/?[^<]*>)/g, '&lt;')

        this.msg.clutter_text.set_markup(words);
    },

    check_deferred_tasks: function (today = G.date_yyyymmdd()) {
        if (! this.defer_date) return false;

        this.creation_date = this.defer_date;

        if (this.defer_date > today) {
            this.is_deferred = true;
            return false;
        }

        let prev = this.is_deferred;
        this.is_deferred = false;
        return prev;
    },

    check_recurrence: function () {
        if (! this.rec_str) return false;

        let [do_recur, next_rec] = this._get_recurrence_date();

        if (do_recur) {
            // update/insert creation date
            {
                let words = this.task_str.split(/ +/);
                let idx;

                if      (this.completed)          idx = 2;
                else if (this.priority !== '(_)') idx = 1;
                else                              idx = 0;

                if (REG.TODO_DATE.test(words[idx]))
                    words[idx] = G.date_yyyymmdd();
                else
                    words.splice(idx, 0, G.date_yyyymmdd());

                this.task_str = words.join(' ');
            }

            if (this.completed) this.toggle_task();
            else                this.reset(true);

            return do_recur;
        }

        if (next_rec) this.rec_next = next_rec;

        return do_recur;
    },

    // This function assumes that the creation/completion dates are either valid
    // or equal to '0000-00-00' and that if a particular type of recurrence
    // needs a creation/completion date that it will be already there.  This is
    // all done in the _parse_task_str func.
    //
    // returns array : [do_recur, next_recurrence]
    //
    // @do_recur        : bool    (whether or not the task should recur today)
    // @next_recurrence : string  (date of next recurrence in yyyy-mm-dd format)
    //
    // @next_recurrence can be an empty string, which indicates that the next
    // recurrence couldn't be computed. E.g., the task recurs n days after
    // completion but isn't completed.
    _get_recurrence_date: function () {
        let res   = [false, ''];
        let today = G.date_yyyymmdd();

        if (this.rec_type === 3) {
            let increment =
                +(this.rec_str.slice(this.rec_str.indexOf('-') + 1, -1));

            let year  = +(this.creation_date.substr(0, 4));
            let month = +(this.creation_date.substr(5, 2));
            let day   = +(this.rec_str.slice(this.rec_str.indexOf(':') + 1,
                                             this.rec_str.indexOf('d')));
            let iter  = "%d-%02d-%02d".format(year, month, day);

            while (iter < today) {
                month += increment;
                year  += Math.floor(month / 12);
                month %= 12;

                if (month === 0) {
                    month = 12;
                    year--;
                }

                iter   = "%d-%02d-%02d".format(year, month, day);
            }

            while (! Date.parse(iter)) {
                iter = "%d-%02d-%02d".format(year, month, --day);
            }

            // We never recur a task on date that it was created on since
            // it would be impossible to close it on that date.
            res[0] = (iter === today) && (this.creation_date !== today);

            // - If the recurrence is today, we increment one more time to have
            //   the next recurrence.
            // - If creation date is in the future(iter === this.creation_date),
            //   we increment one more time since the recurrence can never
            //   happen on the date of creation.
            if (res[0] || iter === this.creation_date) {
                month += increment;
                year  += Math.floor(month / 12);
                month %= 12;

                if (month === 0) {
                    month = 12;
                    year--;
                }

                iter   = "%d-%02d-%02d".format(year, month, day);

                while (! Date.parse(iter)) {
                    iter = "%d-%02d-%02d".format(year, month, --day);
                }
            }

            res[1] = iter;
        }
        else {
            let reference_date, rec_str_offset;

            if (this.rec_type === 2) {
                if (this.completion_date === '0000-00-00') return res;

                reference_date = this.completion_date;
                rec_str_offset = 6;
            }
            else {
                reference_date = this.creation_date;
                rec_str_offset = 4;
            }

            let iter      = new Date(reference_date + 'T00:00:00');
            let increment = +(this.rec_str.slice(rec_str_offset, -1)) *
                (this.rec_str[this.rec_str.length - 1] === 'w' ? 7 : 1);

            while (G.date_yyyymmdd(iter) < today) {
                iter.setDate(iter.getDate() + increment);
            }

            res[0] = G.date_yyyymmdd(iter) === today && reference_date !== today;

            if (res[0] || G.date_yyyymmdd(iter) === reference_date)
                iter.setDate(iter.getDate() + increment);

            res[1] = G.date_yyyymmdd(iter);
        }

        return res;
    },

    update_body_markup: function () {
        let i, idx;

        for (i = 0; i < this.context_indices.length; i++) {
            idx = this.context_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.custom_css['-timepp-context-color'][0] + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        for (i = 0; i < this.project_indices.length; i++) {
            idx = this.project_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.custom_css['-timepp-project-color'][0] + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        for (i = 0; i < this.link_indices.length; i++) {
            idx = this.link_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.custom_css['-timepp-link-color'][0] + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        this.msg.clutter_text.set_markup(this.description_markup.join(' '));
    },

    update_dates_markup: function () {
        //
        // set the custom (todo.txt extension) dates
        //
        let markup = '';

        if (this.rec_str) {
            let txt = '';

            if (this.rec_type === 2) {
                let type = this.rec_str[this.rec_str.length - 1];
                let num  = +(this.rec_str.slice(6, -1)) * (type === 'w' ? 7 : 1);

                txt =
                    _('recurrence') + ': ' +
                    ngettext('%d day after completion',
                             '%d days after completion', num).format(num);
            }
            else {
                txt = `${_('recurrence')}:&#160;${this.rec_next}&#160;(${G.date_delta_str(this.rec_next)})   `;
            }

            markup +=
                '<span font-weight="bold" foreground="' +
                this.custom_css['-timepp-rec-date-color'][0] + '">' +
                txt + '</span>';
        }

        if (this.due_date !== '9999-99-99') {
            markup +=
                '<span font-weight="bold" foreground="' +
                this.custom_css['-timepp-due-date-color'][0] + '">' +
                `${_('due')}:&#160;${this.due_date}&#160;(${G.date_delta_str(this.due_date)})   ` +
                '</span>';
        }

        if (this.is_deferred) {
            markup +=
                '<span font-weight="bold" foreground="' +
                this.custom_css['-timepp-defer-date-color'][0] + '">' +
                `${_('deferred')}:&#160;${this.defer_date}&#160;(${G.date_delta_str(this.defer_date)})   ` +
                '</span>';
        }

        if (markup) {
            if (! this.ext_date_labels) {
                this.ext_date_labels = new St.Label({ y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'todotxt-extension-dates' });
                this.task_item_content.add_child(this.ext_date_labels);
                this.ext_date_labels.clutter_text.line_wrap      = true;
                this.ext_date_labels.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                this.ext_date_labels.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
            }

            this.ext_date_labels.clutter_text.set_markup(markup);
        }
        else if (this.ext_date_labels) {
            this.ext_date_labels.destroy();
            this.ext_date_labels = null;
        }


        //
        // set creation/completion dates
        //
        let has_completion = (this.completion_date !== '0000-00-00');
        let has_creation   = (this.creation_date   !== '0000-00-00');

        if (has_creation || has_completion) {
            if (! this.base_date_labels) {
                this.base_date_labels = new St.Label({ y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'date-label popup-inactive-menu-item', pseudo_class: 'insensitive' });
                this.task_item_content.add_child(this.base_date_labels);
                this.base_date_labels.clutter_text.line_wrap      = true;
                this.base_date_labels.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                this.base_date_labels.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
            }

            this.base_date_labels.text = '';

            if (has_creation) {
                this.base_date_labels.clutter_text.set_markup(
                    `${_('created')}:&#160;${this.creation_date}   `);
            }

            if (has_completion) {
                this.base_date_labels.clutter_text.set_markup(
                    `${_('completed')}:&#160;${this.completion_date}`);
            }
        }
        else if (this.base_date_labels) {
            this.base_date_labels.destroy();
            this.base_date_labels = null;
        }
    },

    toggle_task: function () {
        this._hide_header_icons();

        if (this.completed) {
            let words = this.task_str.split(/ +/);

            // See if there's an old priority stored in an ext (e.g., pri:A).
            let prio  = '';
            for (let i = 0, len = words.length; i < len; i++) {
                if (REG.TODO_PRIO_EXT.test(words[i])) {
                    prio = '(' + words[i][4] + ') ';
                    words.splice(i, 1);
                    break;
                }
            }

            // remove the 'x' and completion date
            if (Date.parse(words[1])) words.splice(0, 2);
            else                      words.splice(0, 1);

            this.reset(true, prio + words.join(' '));
        }
        else {
            this.delegate.time_tracker.stop_tracking(this);

            if (this.priority === '(_)') {
                this.task_str = 'x ' + G.date_yyyymmdd() + ' ' + this.task_str;
            }
            else {
                this.task_str = 'x ' +
                                G.date_yyyymmdd() +
                                this.task_str.slice(3) +
                                ' pri:' + this.priority[1];
            }

            this.reset(true);
        }
    },

     // @SPEED Lazy load the icons.
    _create_header_icons: function () {
        if (this.header_icon_box) return;

        // icon box
        this.header_icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.add(this.header_icon_box, {expand: true});


        // statistics icon
        this.stat_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE });
        this.header_icon_box.add_actor(this.stat_icon_bin);

        this.stat_icon = new St.Icon({ icon_name: 'timepp-graph-symbolic' });
        this.stat_icon_bin.add_actor(this.stat_icon);


        // settings icon
        this.edit_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE });
        this.header_icon_box.add_actor(this.edit_icon_bin);

        this.edit_icon = new St.Icon({ icon_name: 'timepp-edit-symbolic' });
        this.edit_icon_bin.add_actor(this.edit_icon);


        // time tracker start button
        this.tracker_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE, style_class: 'tracker-start-icon'});
        this.header_icon_box.add_actor(this.tracker_icon_bin);

        this.tracker_icon = new St.Icon({ icon_name: 'timepp-start-symbolic' });
        this.tracker_icon_bin.add_actor(this.tracker_icon);


        // listen
        this.delegate.sigm.connect_press(this.stat_icon_bin, () => {
            this.delegate.show_view__time_tracker_stats(this);
            Mainloop.idle_add(() => this._hide_header_icons());
            return Clutter.EVENT_STOP;
        });
        this.delegate.sigm.connect_press(this.edit_icon_bin, () => {
            this.delegate.show_view__task_editor(this);
            Mainloop.idle_add(() => this._hide_header_icons());
            return Clutter.EVENT_STOP;
        });
        this.delegate.sigm.connect_press(this.tracker_icon_bin, () => {
            this.delegate.time_tracker.toggle_tracking(this);
            return Clutter.EVENT_STOP;
        });
    },

    _show_header_icons: function () {
        this._create_header_icons();

        if (!this.hidden && !this.completed)
            this.tracker_icon_bin.show();

        if (this.actor.visible) {
            this.edit_icon_bin.show();
            if (!this.hidden) this.stat_icon_bin.show();
        }
    },

    _hide_header_icons: function () {
        if (! this.header_icon_box) return;

        if (this.tracker_icon_bin.style_class === 'tracker-start-icon') {
            // If we are not tracking the task (no need to show the play/pause
            // button), then we might as well destroy the icon box.
            this.header_icon_box.destroy();
            this.header_icon_box = null;
        }
        else {
            this.stat_icon_bin.hide();
            this.edit_icon_bin.hide();
        }
    },

    _toggle_tracker_icon: function () {
        if (this.tracker_icon_bin.style_class === 'tracker-start-icon')
            this._show_tracker_running_icon();
        else
            this._show_tracker_stopped_icon();
    },

    _show_tracker_running_icon: function () {
        this._create_header_icons();
        this.tracker_icon.icon_name       = 'timepp-stop-symbolic';
        this.tracker_icon_bin.style_class = 'tracker-pause-icon';
        this.tracker_icon_bin.visible     = true;
    },

    _show_tracker_stopped_icon: function () {
        this.tracker_icon.icon_name       = 'timepp-start-symbolic';
        this.tracker_icon_bin.style_class = 'tracker-start-icon';
        this.tracker_icon_bin.visible     = this.edit_icon_bin.visible;
    },

    on_tracker_started: function () {
        this._show_tracker_running_icon();
    },

    on_tracker_stopped: function () {
        this._show_tracker_stopped_icon();
    },

    // Return word under mouse cursor if it's a context or project, else null.
    _find_keyword: function (event) {
        let len = this.msg.clutter_text.text.length;

        // get screen coord of mouse
        let [x, y] = event.get_coords();

        // make coords relative to the msg actor
        [, x, y] = this.msg.transform_stage_point(x, y);

        // find pos of char that was clicked
        let pos = this.msg.clutter_text.coords_to_position(x, y);


        //
        // get word that contains the clicked char
        //
        let words   = MISC_UTILS.split_on_whitespace(this.msg.text);
        let i       = 0;
        let abs_idx = 0;

        outer: for (; i < words.length; i++) {
            for (let j = 0; j < words[i].length; j++) {
                if (abs_idx === pos) break outer;
                abs_idx++;
            }

            abs_idx++;
        }

        if (i > words.length - 1) return null;

        if (REG.TODO_CONTEXT.test(words[i]) || REG.TODO_PROJ.test(words[i]) ||
            REG.URL.test(words[i]) || REG.FILE_PATH.test(words[i]))
            return words[i];
        else
            return null;
    },

    _on_event: function (actor, event) {
        switch (event.type()) {
            case Clutter.EventType.ENTER: {
                if (!this.actor.contains(event.get_related())) {
                    this._show_header_icons();
                }
                break;
            }

            case Clutter.EventType.LEAVE: {
                if (!this.header.contains(global.stage.get_key_focus()) &&
                    !this.actor.contains(event.get_related())) {

                    this._hide_header_icons();
                }

                break;
            }

            case Clutter.EventType.KEY_RELEASE: {
                this._show_header_icons();
                MISC_UTILS.scroll(this.delegate.tasks_scroll,
                                  this.delegate.tasks_scroll_content,
                                  actor);

                break;
            }

            case Clutter.EventType.KEY_PRESS: {
                Mainloop.idle_add(() => {
                    if (! this.header.contains(global.stage.get_key_focus()))
                        this._hide_header_icons();
                });
                break;
            }

            case Clutter.EventType.BUTTON_RELEASE: {
                if (this.prio_label.has_pointer) {
                    this.delegate.add_task_button.grab_key_focus();
                    this.delegate.toggle_filter(this.priority);
                }
                else if (this.msg.has_pointer) {
                    if (! this.current_keyword) break;

                    this.delegate.add_task_button.grab_key_focus();

                    if (REG.URL.test(this.current_keyword)) {
                        MISC_UTILS.open_web_uri(this.current_keyword);
                    }
                    else if (REG.FILE_PATH.test(this.current_keyword)) {
                        MISC_UTILS.open_file_path(this.current_keyword);
                    }
                    else this.delegate.toggle_filter(this.current_keyword);
                }

                break;
            }
        }
    },
});
Signals.addSignalMethods(TaskItem.prototype);
