const St       = imports.gi.St;
const Gio      = imports.gi.Gio
const Meta     = imports.gi.Meta;
const GLib     = imports.gi.GLib;
const Pango    = imports.gi.Pango;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;
const CheckBox = imports.ui.checkBox;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const MISC = ME.imports.lib.misc_utils;
const REG  = ME.imports.lib.regex;
const DND  = ME.imports.lib.dnd;


const G = ME.imports.sections.todo.GLOBAL;

const DOUBLE_CLICK_DELAY = 200000; // 200 ms
let LAST_TIME_CLICKED    = 0; // for double click on task



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
var TaskItem  = class TaskItem {
    

    constructor (ext, delegate, task_str, self_update = true) {
        this.ext      = ext;
        this.delegate = delegate;
        this.task_str = task_str;


        //
        // @NOTE
        // If a var needs to be resettable, add it to the reset_props() method
        // instead of the constructor() method.
        //


        this.custom_css = this.ext.custom_css;


        // Project/context/url below mouse pointer, null if none of those.
        this.current_keyword = null;


        // Each time the task is added somewhere, these three props must be
        // updated.
        this.owner            = null; // js obj
        this.actor_parent     = null; // clutter actor containing this.actor
        this.actor_scrollview = null; // StScrollView (optional)


        //
        // container
        //
        this.actor = new St.Bin({ style: `width: ${delegate.settings.get_int('todo-task-width')}px;`, reactive: true, y_fill: true, x_fill: true, style_class: 'task-item' });
        this.task_item_content = new St.BoxLayout({ vertical: true, style_class: 'task-item-content' });
        this.actor.add_actor(this.task_item_content);


        //
        // DND
        //
        this.dnd = new DND.Draggable(this, G.DNDGroup.TASK);


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
        this.prio_label = new St.Label({ reactive: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'priority-label' });
        this.header.add_child(this.prio_label);


        //
        // body
        //
        this.msg = new St.Label({ reactive: true, y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'description-label'});
        this.task_item_content.add_child(this.msg);
        this.msg.clutter_text.line_wrap        = true;
        this.msg.clutter_text.single_line_mode = false;
        this.msg.clutter_text.ellipsize        = Pango.EllipsizeMode.NONE;
        this.msg.clutter_text.line_wrap_mode   = Pango.WrapMode.WORD_CHAR;


        //
        // init the remaining vars and parse task string
        //
        this.reset(self_update);


        //
        // listen
        //
        this.msg.connect('motion-event', (_, event) => {
            this.current_keyword = this._find_keyword(event);
            if (this.current_keyword) MISC.global_wrapper.display.set_cursor(Meta.Cursor.POINTING_HAND);
            else                      MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.msg.connect('leave-event', () => MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT));
        this.actor.connect('event', (actor, event) => this._on_event(actor, event));
        this.completion_checkbox.connect('clicked', () => this.toggle_task());
    }

    reset (self_update, task_str, update_tracker = true) {
        if (task_str) {
            if (update_tracker && this.delegate.time_tracker)
                this.delegate.time_tracker.update_record_name(this.task_str, task_str);

            this.task_str = task_str;
        }

        this.reset_props();

        this._parse_task_str();

        if (self_update) {
            this.check_recurrence();
            this.check_deferred_tasks();
            this.update_dates_markup();
        }
    }

    reset_props () {
        this.actor.style_class = 'task-item';

        this.msg.text = '';
        this.msg_text = ''; // for sorting purposes we want this prop not nested

        this.tracker_id = '';

        this.pinned = 0; // 0 or 1

        this.kanban_boards = null;

        // We create these St.Label's on demand.
        if (this.base_date_labels) this.base_date_labels.destroy();
        if (this.ext_date_labels)  this.ext_date_labels.destroy();
        this.base_date_labels = null; // creation/completion dates
        this.ext_date_labels  = null; // todo.txt extension dates

        // For sorting purposes, we set the prio to '(_)' when there is no prio.
        this.priority           = '(_)';
        this.prio_label.text    = '';
        this.finish_scrolling_priority = false;

        this.projects = [];
        this.contexts = [];

        // For sorting purposes, we set the dates to this when they don't exist.
        this.creation_date   = '0000-00-00';
        this.completion_date = '0000-00-00';
        this.due_date        = '9999-99-99';
        this.due_in_days     = 99999999;

        this.completed                   = false;
        this.completion_checkbox.checked = false;
        this.completion_checkbox.visible = true;

        if (this.hidden) this.header.remove_child(this.header.get_child_at_index(0));
        this.hidden = false;

        this.defer_date  = '';
        this.is_deferred = false;

        // The recurrence type is one of: 1, 2, 3
        // The numbers just match the global regex TODO_REC_EXT_[123]
        // rec_next is one of:
        //     - '9999-99-99' when rec_str is ''
        //     - '8999-99-99' when rec_str is given but next rec is unknown
        //     - date of next recurrence
        this.rec_type = 1;
        this.rec_str  = '';
        this.rec_next = '9999-99-99';

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

        this.hide_header_icons();
    }

    _parse_task_str () {
        // The 'header' is part of the task_str at the start that includes
        // the 'x' (checked) sign, the priority, and the completion/creation
        // dates.
        // The 'description' is everything else.

        let words    = GLib.markup_escape_text(this.task_str, -1);
        words        = words.replace(/\\n/g, '\n');
        words        = MISC.split_on_whitespace(words);
        let len      = words.length;
        let desc_pos = 0; // idx of first word of 'description' in words arr


        //
        // Parse 'header'
        //
        // The header consists of the first few tokens separated by a single
        // space. The possibilities are:
        //
        // - ["x"]
        // - ["x", " ", "completion-date"]
        // - ["x", " ", "completion-date", " ", "creation-date"]
        //
        // - ["(A)"]
        // - ["(A)", " ", "creation-date"]
        //
        // - ["creation-date"]
        // - []
        //
        // @NOTE: split_on_whitespace() keeps the whitespace between tokens as
        // separate items in the words array.
        if (words[0] === 'x') {
            this.completed                   = true;
            this.completion_checkbox.checked = true;
            this.actor.add_style_class_name('completed');

            if (len > 2 && REG.ISO_DATE.test(words[2]) && Date.parse(words[2])) {
                this.completion_date = words[2];

                if (len > 4 && REG.ISO_DATE.test(words[4]) && Date.parse(words[4])) {
                    this.creation_date = words[4];
                    desc_pos           = 5;
                }
                else desc_pos = 3;
            }
            else desc_pos = 1;
        }
        else if (REG.TODO_PRIO.test(words[0])) {
            this.actor.add_style_class_name(words[0][1]);
            this.prio_label.visible = true;
            this.prio_label.text    = words[0];
            this.priority           = words[0];

            if (len > 2 && REG.ISO_DATE.test(words[2]) && Date.parse(words[2])) {
                this.creation_date = words[2];
                desc_pos           = 3;
            }
            else desc_pos = 1;
        }
        else if (REG.ISO_DATE.test(words[0]) && Date.parse(words[0])) {
            this.creation_date = words[0];
            desc_pos           = 1;
        }


        //
        // Parse 'description'
        //
        // The description is the rest of the task string.
        //
        if (words.length && !/\S/.test(words[desc_pos])) desc_pos++;
        words = words.slice(desc_pos, len);
        len   = words.length;

        let inside_backticks = false;

        for (let i = 0; i < len; i++) {
            let word = words[i];

            if (word.startsWith('`') || word.endsWith('`')) inside_backticks = !inside_backticks;
            if (inside_backticks) continue;

            if (REG.TODO_CONTEXT.test(word)) {
                this.context_indices.push(i);
                if (this.contexts.indexOf(word) === -1) {
                    this.contexts.push(word);
                }
                words[i] =
                    '`<span foreground="' +
                    this.custom_css['-timepp-context-color'][0] +
                    '"><b>' + word + '</b></span>`';
            }
            else if (REG.TODO_PROJ.test(word)) {
                this.project_indices.push(i);
                if (this.projects.indexOf(word) === -1) {
                    this.projects.push(word);
                }
                words[i] =
                    '`<span foreground="' +
                    this.custom_css['-timepp-project-color'][0] +
                    '"><b>' + word + '</b></span>`';
            }
            else if (REG.URL.test(word) || REG.FILE_PATH.test(word)) {
                this.link_indices.push(i);
                words[i] =
                    '`<span foreground="' +
                    this.custom_css['-timepp-link-color'][0] +
                    '"><u><b>' + word + '</b></u></span>`';
            }
            else if (REG.TODO_EXT.test(word)) {
                if (REG.TODO_KANBAN_EXT.test(word)) {
                    if (! this.kanban_boards) this.kanban_boards = [word];
                    else                      this.kanban_boards.push(word);

                    if (word[4] === '*') {
                        words[i] = '`<span foreground="' + this.custom_css['-timepp-due-date-color'][0] + '"><b>' + word + '</b></span>`';
                    } else {
                        words[i] = '`<b>' + word + '</b>`';
                    }
                }
                else if (this.hidden) {
                    // Ignore all other extensions if task is hidden.
                    continue;
                }
                else if (REG.TODO_TRACKER_ID_EXT.test(word)) {
                    this.tracker_id = word.slice(11);
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_DUE_EXT.test(word)) {
                    if (this.rec_str) continue;

                    this.due_date = word.slice(4);
                    words.splice(i, 1); i--; len--;
                    this.due_in_days = MISC.date_delta(this.due_date);
                }
                else if (REG.TODO_DEFER_EXT.test(word)) {
                    if (this.rec_str) continue;

                    this.defer_date = word.slice(word.indexOf(':') + 1);
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_1.test(word)) {
                    if (this.due_date !== '9999-99-99' || this.creation_date === '0000-00-00')
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 1;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_2.test(word)) {
                    if (this.due_date !== '9999-99-99' || (this.completed && this.completion_date === '0000-00-00'))
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 2;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_REC_EXT_3.test(word)) {
                    if (this.due_date !== '9999-99-99' || this.creation_date === '0000-00-00')
                        continue;

                    this.rec_str  = word;
                    this.rec_type = 3;
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_PIN_EXT.test(word)) {
                    this.pinned = 1;
                    this._create_header_icons();
                    this.pin_icon.add_style_class_name('active');
                    this.pin_icon.show();
                    words.splice(i, 1); i--; len--;
                }
                else if (REG.TODO_HIDE_EXT.test(word)) {
                    let temp = this.kanban_boards; // don't reset kanban ext

                    this.reset_props();

                    this.kanban_boards = temp;

                    this.hidden = true;

                    this.completion_checkbox.hide();
                    this.prio_label.hide();
                    this.actor.add_style_class_name('hidden-task');
                    let icon_incognito_bin = new St.Button({ can_focus: true });
                    this.header.insert_child_at_index(icon_incognito_bin, 0);
                    icon_incognito_bin.add_actor(new St.Icon({ gicon : MISC.getIcon('timepp-hidden-symbolic') }));

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

        words = words.join('');
        words = MISC.markdown_to_pango(words, this.ext.markdown_map);

        this.msg.clutter_text.set_markup(words);
        this.msg_text = this.msg.text;
    }

    check_deferred_tasks (today = MISC.date_yyyymmdd()) {
        if (! this.defer_date) return false;

        this.creation_date = this.defer_date;

        if (this.defer_date > today) {
            this.is_deferred = true;
            return false;
        }

        let prev = this.is_deferred;
        this.is_deferred = false;
        return prev;
    }

    check_recurrence () {
        if (! this.rec_str) return false;

        let [do_recur, next_rec] = this._get_recurrence_date();

        if (do_recur) {
            // update/insert creation date
            {
                let words = this.task_str.split(' ');
                let idx;

                if      (this.completed)          idx = 2;
                else if (this.priority !== '(_)') idx = 1;
                else                              idx = 0;

                if (REG.ISO_DATE.test(words[idx]))
                    words[idx] = MISC.date_yyyymmdd();
                else
                    words.splice(idx, 0, MISC.date_yyyymmdd());

                this.task_str = words.join(' ');
            }

            if (this.completed) this.toggle_task();
            else                this.reset(true);

            return do_recur;
        }

        if (next_rec) this.rec_next = next_rec;

        return do_recur;
    }

    // This function assumes that the creation/completion dates are either valid
    // or equal to '0000-00-00' and that if a particular type of recurrence
    // needs a creation/completion date that it will be already there.  This is
    // all done in the _parse_task_str func.
    //
    // returns array : [do_recur, next_recurrence]
    //
    // @do_recur        : bool   (whether or not the task should recur today)
    // @next_recurrence : string (date of next recurrence in yyyy-mm-dd format
    //                            or '0000-00-00' when unknown)
    //
    // @next_recurrence can be an empty string, which indicates that the next
    // recurrence couldn't be computed. E.g., the task recurs n days after
    // completion but isn't completed.
    _get_recurrence_date () {
        let res   = [false, '8999-99-99'];
        let today = MISC.date_yyyymmdd();

        if (this.rec_type === 3) {
            let increment =
                +(this.rec_str.slice(this.rec_str.indexOf('-') + 1, -1));

            let year  = +(this.creation_date.substr(0, 4));
            let month = +(this.creation_date.substr(5, 2));
            let day   = +(this.rec_str.slice(this.rec_str.indexOf(':') + 1, this.rec_str.indexOf('d')));
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
        } else {
            let reference_date, rec_str_offset;

            if (this.rec_type === 2) {
                if (this.completion_date === '0000-00-00') return res;

                reference_date = this.completion_date;
                rec_str_offset = 6;
            } else {
                reference_date = this.creation_date;
                rec_str_offset = 4;
            }

            let iter      = new Date(reference_date + 'T00:00:00');
            let increment = +(this.rec_str.slice(rec_str_offset, -1)) *
                             (this.rec_str[this.rec_str.length - 1] === 'w' ? 7 : 1);

            while (MISC.date_yyyymmdd(iter) < today) {
                iter.setDate(iter.getDate() + increment);
            }

            res[0] = MISC.date_yyyymmdd(iter) === today && reference_date !== today;

            if (res[0] || MISC.date_yyyymmdd(iter) === reference_date)
                iter.setDate(iter.getDate() + increment);

            res[1] = MISC.date_yyyymmdd(iter);
        }

        return res;
    }

    update_body_markup () {
        this.msg.text = '';

        for (let it of this.context_indices) {
            this.description_markup[it] =
                '`<span foreground="' +
                this.custom_css['-timepp-context-color'][0] + '"' +
                this.description_markup[it].slice(this.description_markup[it].indexOf('>'));
        }

        for (let it of this.project_indices) {
            this.description_markup[it] =
                '`<span foreground="' +
                this.custom_css['-timepp-project-color'][0] + '"' +
                this.description_markup[it].slice(this.description_markup[it].indexOf('>'));
        }

        for (let it of this.link_indices) {
            this.description_markup[it] =
                '`<span foreground="' +
                this.custom_css['-timepp-link-color'][0] + '"' +
                this.description_markup[it].slice(this.description_markup[it].indexOf('>'));
        }

        let markup = this.description_markup.join('');
        markup     = MISC.markdown_to_pango(markup, this.ext.markdown_map);

        this.msg.clutter_text.set_markup(markup);
    }

    update_dates_markup () {
        //
        // set the custom (todo.txt extension) dates
        //
        let markup = '';

        if (this.rec_str) {
            let txt = '';

            if (this.rec_type === 2 && !this.completed) {
                let type = this.rec_str[this.rec_str.length - 1];
                let num  = +(this.rec_str.slice(6, -1)) * (type === 'w' ? 7 : 1);

                txt =
                    _('recurrence') + ': ' +
                    ngettext('%d day after completion',
                             '%d days after completion', num).format(num);
            } else {
                txt = `${_('recurrence')}:&#160;${this.rec_next}&#160;(${MISC.date_delta_str(this.rec_next)})   `;
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
                `${_('due')}:&#160;${this.due_date}&#160;(${MISC.date_delta_str(this.due_date)})   ` +
                '</span>';
        }

        if (this.is_deferred) {
            markup +=
                '<span font-weight="bold" foreground="' +
                this.custom_css['-timepp-defer-date-color'][0] + '">' +
                `${_('deferred')}:&#160;${this.defer_date}&#160;(${MISC.date_delta_str(this.defer_date)})   ` +
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

            let markup = '';

            if (has_creation)
                markup += `${_('created')}:&#160;${this.creation_date}   `;

            if (has_completion)
                markup += `${_('completed')}:&#160;${this.completion_date}`;

            this.base_date_labels.clutter_text.set_markup(markup);
        }
        else if (this.base_date_labels) {
            this.base_date_labels.destroy();
            this.base_date_labels = null;
        }
    }

    toggle_task () {
        if (this.completed) {
            let words = this.task_str.split(' ');

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
        } else {
            this.delegate.time_tracker.stop_tracking(this);

            let task_str = this.task_str;

            if (this.priority === '(_)')
                task_str = `x ${MISC.date_yyyymmdd()} ${task_str}`;
            else
                task_str = `x ${MISC.date_yyyymmdd()} ${task_str.slice(4)} pri:${this.priority[1]}`;

            this.reset(true, task_str);
        }

        Mainloop.timeout_add(0, () => this.delegate.on_tasks_changed(true, true));
    }

     // @SPEED Lazy load the icons.
    _create_header_icons () {
        if (this.header_icon_box) return;

        this.header_icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.add(this.header_icon_box, {expand: true});

        this.stat_icon = new St.Icon({ visible:false, reactive: true, can_focus: true, track_hover: true, gicon : MISC.getIcon('timepp-graph-symbolic') });
        this.header_icon_box.add_actor(this.stat_icon);

        this.pin_icon = new St.Icon({ visible:false, reactive: true, can_focus: true, track_hover: true, gicon : MISC.getIcon('timepp-pin-symbolic'), style_class: 'pin-icon' });
        this.header_icon_box.add_actor(this.pin_icon);

        this.edit_icon = new St.Icon({ visible:false, reactive: true, can_focus: true, track_hover: true, gicon : MISC.getIcon('timepp-edit-symbolic') });
        this.header_icon_box.add_actor(this.edit_icon);

        this.tracker_icon = new St.Icon({ visible:false, reactive: true, can_focus: true, track_hover: true, gicon : MISC.getIcon('timepp-start-symbolic'), style_class: 'tracker-start-icon' });
        this.header_icon_box.add_actor(this.tracker_icon);

        // @NOTE: Use connect_press here because we need to play well with dnd.
        this.delegate.sigm.connect_press(this.stat_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this.delegate.show_view__time_tracker_stats(this);
            this.hide_header_icons();
        });
        this.delegate.sigm.connect_press(this.pin_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this._on_pin_icon_clicked();
        });
        this.delegate.sigm.connect_press(this.edit_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this.delegate.show_view__task_editor(this);
            Mainloop.idle_add(() => MISC.maybe_ignore_release(this.ext.menu.actor));
            this.hide_header_icons();
        });
        this.delegate.sigm.connect_press(this.tracker_icon, Clutter.BUTTON_PRIMARY, true, () => {
            this.delegate.time_tracker.toggle_tracking(this);
        });
    }

    show_header_icons () {
        this._create_header_icons();

        if (!this.hidden && !this.completed)
            this.tracker_icon.show();

        if (this.actor.visible) {
            this.edit_icon.show();
            if (!this.hidden) {
                this.pin_icon.show();
                this.stat_icon.show();
            }
        }
    }

    hide_header_icons () {
        if (! this.header_icon_box) return;

        if (this.tracker_icon.style_class === 'tracker-start-icon' && !this.pinned) {
            // We destroy the icon box when we don't have to show any icons.
            this.header_icon_box.destroy();
            this.header_icon_box = null;
            this.stat_icon       = null;
            this.pin_icon        = null;
            this.edit_icon       = null;
            this.tracker_icon    = null;
        } else {
            this.stat_icon.hide();
            this.edit_icon.hide();
            this.pin_icon.visible = this.pinned;
            this.tracker_icon.visible = this.tracker_icon.style_class !== 'tracker-start-icon';
        }
    }

    _on_pin_icon_clicked () {
        this.pinned = (this.pinned === 1) ? 0 : 1;
        let old_task_str = this.task_str;

        if (this.pinned)  {
            this.pin_icon.add_style_class_name('active');
            this.task_str += ' pin:1';
        } else {
            this.pin_icon.remove_style_class_name('active');

            let words = MISC.split_on_whitespace(this.task_str);
            for (let i = 0, len = words.length; i < len; i++) {
                if (REG.TODO_PIN_EXT.test(words[i])) {
                    words.splice(i, 1);
                    break;
                }
            }

            this.task_str = words.join('');
        }

        if (this.delegate.time_tracker) {
            this.delegate.time_tracker.update_record_name(old_task_str, this.task_str);
        }

        if (this.delegate.view_manager.current_view_name !== G.View.SEARCH) {
            Mainloop.timeout_add(0, () => this.delegate.on_tasks_changed(true, true));
        }
    }

    _toggle_tracker_icon () {
        if (this.tracker_icon.style_class === 'tracker-start-icon')
            this._show_tracker_running_icon();
        else
            this._show_tracker_stopped_icon();
    }

    _show_tracker_running_icon () {
        this._create_header_icons();
        this.tracker_icon.gicon = MISC.getIcon('timepp-pause-symbolic');
        this.tracker_icon.style_class = 'tracker-pause-icon';
        this.tracker_icon.visible     = true;
    }

    _show_tracker_stopped_icon () {
        this.tracker_icon.visible     = this.edit_icon.visible;
        this.tracker_icon.style_class = 'tracker-start-icon';
        this.tracker_icon.gicon = MISC.getIcon('timepp-start-symbolic');
    }

    on_tracker_started () {
        this._show_tracker_running_icon();
    }

    on_tracker_stopped () {
        this._show_tracker_stopped_icon();
    }

    // Return word under mouse cursor if it's a context or project, else null.
    _find_keyword (event) {
        let [x, y] = event.get_coords();
        [, x, y]   = this.msg.transform_stage_point(x, y);
        let pos    = this.msg.clutter_text.coords_to_position(x, y);

        if (pos === this.msg.text.length) return;

        let words = MISC.split_on_whitespace(this.msg.get_text());

        let i       = 0;
        let abs_idx = 0;

        for (; i < words.length; i++) {
            abs_idx += words[i].length;
            if (pos < abs_idx) break;
        }

        if (i >= words.length) return null;

        if (REG.TODO_CONTEXT.test(words[i]) ||
            REG.TODO_PROJ.test(words[i])    ||
            REG.URL.test(words[i])          ||
            REG.FILE_PATH.test(words[i]))
            return words[i];
        else
            return null;
    }

    _scroll_task_priority (direction) {
        let prio = this.prio_label.text;

        if (prio) this.actor.remove_style_class_name(prio[1]);

        let prios = ["(A)", "(B)", "(C)", "(D)", "(E)", "(F)", "(G)", "(H)",
                     "(I)", "(J)", "(K)", "(L)", "(M)", "(N)", "(O)", "(P)",
                     "(Q)", "(R)", "(S)", "(T)", "(U)", "(V)", "(W)", "(X)",
                     "(Y)", "(Z)", "(_)"];

        let i;

        if      (direction === Clutter.ScrollDirection.UP)   i = 1;
        else if (direction === Clutter.ScrollDirection.DOWN) i = -1;
        else                                                 return;

        i = prios.indexOf(prio) + i;
        i = i < 0 ? i + 27 : i;

        let new_prio = prios[i % 27];

        if (new_prio === "(_)") {
            this.prio_label.text = "";
        } else {
            this.prio_label.text = new_prio;
            this.actor.add_style_class_name(new_prio[1]);
        }

        this.finish_scrolling_priority = true;
    }

    _finish_scrolling_priority () {
        let t = this.prio_label.text;
        this.reset(true, this.new_str_for_prio(t ? t : '(_)'));
        this.delegate.on_tasks_changed(true, this.delegate.get_current_todo_file().automatic_sort);
    }

    // A little utility func to generate a new task_str with a new property.
    // If the task is completed the 'pri:' extension will be updated/added.
    //
    // @priority: string (prio str or '(_)' to mean 'no priority')
    //
    // returns task string with the updated priority.
    new_str_for_prio (priority, task_str = this.task_str) {
        if (priority !== '(_)' && !REG.TODO_PRIO.test(priority)) return task_str;

        priority = priority === '(_)' ? '' : priority;

        if (task_str.startsWith('x ')) {
            let words = task_str.split(' ');

            for (let i = 0, len = words.length; i < len; i++) {
                if (REG.TODO_PRIO_EXT.test(words[i])) {
                    if (priority) words[i] = 'pri:' + priority[1];
                    else          words.splice(i, 1);

                    return words.join(' ');
                }
            }

            if (priority) return task_str + ' pri:' + priority[1];
        }
        else if (/^\([A-Z]\) /.test(task_str)) {
            if (priority) return priority + ' ' + task_str.slice(4);
            else          return task_str.slice(4);
        }
        else if (priority) {
            return priority + ' ' + task_str;
        }

        return task_str;
    }

    scroll_into_view () {
        if (! this.actor_scrollview) return;

        for (let i = 0; i < 2; i++) {
            for (let s of this.actor_scrollview[i]) {
                MISC.scroll_to_item(s, s.get_last_child(), this.actor, this.actor_parent, !!i);
            }
        }
    }

    _on_event (actor, event) {
        switch (event.type()) {
          case Clutter.EventType.ENTER: {
            let related = event.get_related();

            if (related && !this.actor.contains(related))
                this.show_header_icons();

            if (this.prio_label.has_pointer)
                MISC.global_wrapper.display.set_cursor(Meta.Cursor.POINTING_HAND);
          } break;

          case Clutter.EventType.LEAVE: {
            // related is the new actor we hovered over with the mouse
            let related = event.get_related();

            if (!this.header.contains(global.stage.get_key_focus()) &&
                related &&
                !this.actor.contains(related)) {

                this.hide_header_icons();
            }

            if (this.finish_scrolling_priority)
                this._finish_scrolling_priority();

            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
          } break;

          case Clutter.EventType.KEY_RELEASE: {
            this.show_header_icons();
            if (this.actor_scrollview) this.scroll_into_view();
            this.has_focus = true;
          } break;

          case Clutter.EventType.KEY_PRESS: {
            if (this.has_focus) {
                if (event.get_key_symbol() === Clutter.KEY_e)
                    this.delegate.show_view__task_editor(this);

                Mainloop.timeout_add(0, () => {
                    if (! this.header.contains(global.stage.get_key_focus())) {
                        this.hide_header_icons();
                        this.has_focus = false;
                    }
                });
            } else if (this.actor_scrollview) {
                this.scroll_into_view();
            }
          } break;

          case Clutter.EventType.BUTTON_PRESS: {
            if (this.prio_label.has_pointer) {
                this.delegate.show_view__search(this.prio_label.text);
            } else if (this.msg.has_pointer && this.current_keyword) {
                if (REG.URL.test(this.current_keyword)) {
                    MISC.open_web_uri(this.current_keyword);
                } else if (REG.FILE_PATH.test(this.current_keyword)) {
                    MISC.open_file_path(this.current_keyword);
                } else {
                    this.delegate.show_view__search(this.current_keyword);
                }
            } else { // maybe double click
                let t = GLib.get_monotonic_time();
                if (t - LAST_TIME_CLICKED < DOUBLE_CLICK_DELAY) {
                  LAST_TIME_CLICKED = 0;
                  this.hide_header_icons();
                  this.delegate.show_view__task_editor(this);
                } else {
                  LAST_TIME_CLICKED = t;
                }
            }
          } break;

          case Clutter.EventType.SCROLL: {
            if (this.completion_checkbox.has_pointer && !this.completed) {
                this._scroll_task_priority(event.get_scroll_direction());
                return Clutter.EVENT_STOP;
            }
          } break;
        }
    }
}
Signals.addSignalMethods(TaskItem.prototype);
