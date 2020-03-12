const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Shell     = imports.gi.Shell;
const Pango     = imports.gi.Pango;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ        = ME.imports.lib.fuzzy_search;
const MISC_UTILS  = ME.imports.lib.misc_utils;
const GRAPHS      = ME.imports.lib.graphs;
const FULLSCREEN  = ME.imports.lib.fullscreen;
const DATE_PICKER = ME.imports.lib.date_picker;
const REG         = ME.imports.lib.regex;


const G = ME.imports.sections.todo.GLOBAL;


const HotMode = {
    TASK    : 0,
    PROJECT : 1,
}


const StatsMode = {
    BANNER : 'BANNER',
    GLOBAL : 'GLOBAL',
    SINGLE : 'SINGLE',
    SEARCH : 'SEARCH',
    HOT    : 'HOT',
};


// =====================================================================
// @@@ Stats View
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int (monitor position)
// =====================================================================
var StatsView = class StatsView extends FULLSCREEN.Fullscreen{
    constructor (ext, delegate, monitor) {
        super(monitor);

        this.ext      = ext;
        this.delegate = delegate;

        this.default_style_class = this.actor.style_class;
        this.actor.add_style_class_name('stats');
        this.set_banner_size(0);
        this.bottom_box.hide();

        // so we can have a side menu in the middle next to a vertical box layout
        this.inner_middle_box = new St.BoxLayout({ visible: false, vertical: true, x_expand: true, y_expand: true });
        this.middle_box.add_child(this.inner_middle_box);

        {
            let visible = this.monitor_button.visible;
            this.top_box_left.remove_child(this.monitor_button);
            this.top_box_right.insert_child_at_index(this.monitor_button, 0);
            this.monitor_button.visible = visible;
        }


        this.custom_css = this.ext.custom_css;


        // Values as returned by the time tracker's get_stats.
        // @stats_unique_tasks and @stats_unique_projects are converted into
        // arrays.
        this.stats_data            = null;
        this.stats_unique_tasks    = null;
        this.stats_unique_projects = null;


        // A map between 'human-readable' properties and translated strings as
        // well as date intervals consisting of two date strings in 'yyyy-mm-dd'
        // format.
        // date_str === '' represents an open/half-open interval.
        //
        // The dates intervals are updated by _update_string_date_map() func.
        //
        // @key: string
        // @val: array (of the form [translated_str, range])
        //   - @range: array (of the form [date_str, date_str])
        this.string_date_map = new Map([
            ['today'        , [_('Today')         , ['', '']] ],
            ['week'         , [_('This Week')     , ['', '']] ],
            ['month'        , [_('This Month')    , ['', '']] ],
            ['three_months' , [_('Last 3 Months') , ['', '']] ],
            ['six_months'   , [_('Last 6 Months') , ['', '']] ],
            ['all'          , [_('All Time')      , ['', '']] ],
        ]);


        this.current_mode = this.prev_mode = {
            name   : '',
            args   : null,
            actors : null,
        }


        this.selected_search_result = null; // {label_actor: St.Label, type: string ('()' or '++'}


        // A map from mode names to functions that invoke it.
        this.mode_func_map = {
            [StatsMode.BANNER] : this.show_mode__banner.bind(this),
            [StatsMode.GLOBAL] : this.show_mode__global.bind(this),
            [StatsMode.SINGLE] : this.show_mode__single.bind(this),
            [StatsMode.HOT]    : this.show_mode__hot.bind(this),
        };


        //
        // graph interval icon
        //
        this.graph_interval_icon = new St.Button({ visible: false, y_align: St.Align.MIDDLE, can_focus: true, style_class: 'graph-interval-icon' });
        this.top_box_left.insert_child_at_index(this.graph_interval_icon, 0);
        this.graph_interval_icon.add_actor(new St.Icon({ gicon:
            MISC_UTILS.getIcon(
                this.delegate.settings.get_boolean('todo-graph-shows-intervals') ?
                'timepp-graph-intervals-symbolic' :
                'timepp-graph-symbolic'
            )
        }));


        //
        // heatmap icon
        //
        this.heatmap_icon = new St.Button({ checked: this.delegate.settings.get_boolean('todo-stats-heatmap-visible'), visible: false, y_align: St.Align.MIDDLE, can_focus: true, style_class: 'heatmap-icon' });
        this.top_box_left.insert_child_at_index(this.heatmap_icon, 0);
        this.heatmap_icon.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-heatmap-symbolic') }));


        //
        // nav bar
        //
        this.nav_bar = new St.BoxLayout({ style_class: 'navbar' });
        this.top_box_right.insert_child_at_index(this.nav_bar, 0);

        this.single_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.single_mode_icon);
        this.single_mode_icon.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-search-symbolic') }));

        this.global_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.global_mode_icon);
        this.global_mode_icon.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-home-symbolic') }));

        this.hot_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.hot_mode_icon);
        this.hot_mode_icon.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-fire-symbolic') }));


        //
        // search entry and results container
        //
        this.entry = new St.Entry({ can_focus: true, y_align: Clutter.ActorAlign.CENTER, visible: false, hint_text: _('Search...') });
        this.top_box_center.add_actor(this.entry);
        this.entry.set_primary_icon(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-search-symbolic') }));

        this.search_results_container = new St.BoxLayout({ visible: false, x_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true, style_class: 'search-results-box' });
        this.middle_box.add_actor(this.search_results_container);

        this.task_results    = {};
        this.project_results = {};

        // scrollview for task results
        {
            this.task_results.box = new St.BoxLayout({ visible: false, y_expand: true, vertical: true });
            this.search_results_container.add_actor(this.task_results.box);

            let label = new St.Label({ text: _('Tasks'), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'search-results-label-tasks' });
            this.task_results.box.add_child(label);

            this.task_results.scrollview = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, style_class: 'vfade' });
            this.task_results.box.add_actor(this.task_results.scrollview);

            this.task_results.scrollbox = new St.BoxLayout({ y_expand: true, vertical: true });
            this.task_results.scrollview.add_actor(this.task_results.scrollbox);
        }

        // scrollview for project results
        {
            this.project_results.box = new St.BoxLayout({ visible: false, y_expand: true, vertical: true });
            this.search_results_container.add_actor(this.project_results.box);

            let label = new St.Label({ text: _('Projects'), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'search-results-label-projects' });
            this.project_results.box.add_child(label);

            this.project_results.scrollview = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, style_class: 'vfade' });
            this.project_results.box.add_actor(this.project_results.scrollview);

            this.project_results.scrollbox = new St.BoxLayout({ y_expand: true, vertical: true });
            this.project_results.scrollview.add_actor(this.project_results.scrollbox);
        }


        //
        // date picker
        //
        {
            let today      = MISC_UTILS.date_yyyymmdd();
            let year_start = today.substr(0, 4) + '-01-01';

            this.date_picker = new DATE_PICKER.DatePicker(
                '',
                today,
                [_('Year:'), _('Month:'), _('Day:')]
            );

            this.date_picker.actor.hide();
            this.top_box_left.add_child(this.date_picker.actor);
        }


        //
        // hot mode controls
        //
        {
            let today = MISC_UTILS.date_yyyymmdd();

            this.hot_mode_control_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, visible: false, style_class: 'hot-mode-control-box' });
            this.top_box_left.insert_child_at_index(this.hot_mode_control_box, 0);


            // custom range view
            this.date_range_custom_view = new St.BoxLayout({ visible: false, style_class: 'custom-date-range-box' });
            this.hot_mode_control_box.add_child(this.date_range_custom_view);

            this.bound_date_1 = new DATE_PICKER.DatePicker('', today, ['', '', '']);
            this.date_range_custom_view.add_actor(this.bound_date_1.actor);

            this.date_range_custom_view.add_actor(new St.Label({ text: '...', y_align: Clutter.ActorAlign.END }));

            this.bound_date_2 = new DATE_PICKER.DatePicker('', today, ['', '', '']);
            this.date_range_custom_view.add_actor(this.bound_date_2.actor);

            this.custom_range_ok_btn = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'button btn-ok' });
            this.date_range_custom_view.add_actor(this.custom_range_ok_btn);

            this.custom_range_cancel_btn = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'button btn-cancel' });
            this.date_range_custom_view.add_actor(this.custom_range_cancel_btn);


            // the main view
            this.date_range_main_view = new St.BoxLayout({ style_class: 'btn-box' });
            this.hot_mode_control_box.add_actor(this.date_range_main_view);

            this.type_btn = new St.Button({ can_focus: true, label: '', style_class: 'button' });
            this.date_range_main_view.add_actor(this.type_btn);

            this.type_menu = new PopupMenu.PopupMenu(this.type_btn, 0.5, St.Side.TOP);
            this.menu_manager.addMenu(this.type_menu);
            Main.uiGroup.add_actor(this.type_menu.actor);
            this.type_menu.actor.hide();
            this.type_menu.actor.add_style_class_name('timepp-hot-mode-type-menu');

            this.range_btn = new St.Button({ can_focus: true, label: '', style_class: 'button' });
            this.date_range_main_view.add_actor(this.range_btn);

            this.range_menu = new PopupMenu.PopupMenu(this.range_btn, 0.5, St.Side.TOP);
            this.menu_manager.addMenu(this.range_menu);
            Main.uiGroup.add_actor(this.range_menu.actor);
            this.range_menu.actor.hide();
            this.range_menu.actor.add_style_class_name('timepp-hot-mode-range-menu');

            // fill up range menu
            for (let [key, val] of this.string_date_map) {
                let label = val[0];
                this.range_menu.addAction(label, () => {
                    this.show_mode__hot(label, this.string_date_map.get(key)[1]);
                });
            }

            this.range_menu.addAction(_('Custom Range...'), () => {
                this.date_range_main_view.hide();
                this.date_range_custom_view.show();
                Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
            });

            this.type_menu.addAction(_('Projects'), () => {
                this.delegate.settings.set_enum('todo-hot-mode-type', HotMode.PROJECT);
                this.show_mode__hot(this.current_mode.args[0], this.current_mode.args[1]);
            });

            this.type_menu.addAction(_('Tasks'), () => {
                this.delegate.settings.set_enum('todo-hot-mode-type', HotMode.TASK);
                this.show_mode__hot(this.current_mode.args[0], this.current_mode.args[1]);
            });
        }


        //
        // heatmap graph
        //
        this.heatmap_graph = new GRAPHS.HeatMap();
        this.inner_middle_box.add_child(this.heatmap_graph.actor);
        this.heatmap_graph.actor.hide();

        this.heatmap_graph.params.tooltip_callback = (label) => {
            let [date, time] = label.split(' ');

            if (time === '0') return date;

            let time_str = '%dh %dmin %ds'.format(
                Math.floor(time / 3600),
                Math.floor(time % 3600 / 60),
                time % 60
            );

            return date + '   ' + time_str;
        };


        //
        // vbars graph
        //
        this.vbars_graph = new GRAPHS.VBars();
        this.inner_middle_box.add_child(this.vbars_graph.actor);
        this.vbars_graph.actor.hide();


        //
        // sum stats card
        //
        {
            this.stats_card = new St.BoxLayout({ vertical: true, visible: false, x_expand: true, y_expand: true, style_class: 'sum-stats-card' });
            this.middle_box.add_child(this.stats_card);

            ['stats_card_title', 'stats_card_stats'].forEach((it) => {
                let scroll = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER });
                this.stats_card.add_child(scroll);

                let content = new St.BoxLayout({ vertical: true });
                scroll.add_actor(content);

                this[it] = new St.Label();
                content.add_child(this[it]);

                this[it].clutter_text.line_wrap      = true;
                this[it].clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
                this[it].clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            });
        }


        //
        // listen
        //
        this.new_day_sig_id =
            this.delegate.connect('new-day', (_, today) => {
                this._on_new_day_started(today);
            });
        this.vbars_graph.connect('vbar-clicked', (_, vbar, interval_idx) => {
            let d = new Date();
            this.show_mode__single(d.getFullYear(), d.getMonth(), vbar.info.label, vbar.info.type);
        });
        this.custom_range_ok_btn.connect('clicked', () => {
            let [, date_str_1] = this.bound_date_1.get_date();
            let [, date_str_2] = this.bound_date_2.get_date();
            let label          = date_str_1 + '   ...   ' + date_str_2;

            this.show_mode__hot(label, [date_str_1, date_str_2]);

            this.date_range_main_view.show();
            this.date_range_custom_view.hide();
            Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
        });
        this.custom_range_cancel_btn.connect('clicked', () => {
            this.date_range_main_view.show();
            this.date_range_custom_view.hide();
            Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
        });
        this.actor.connect('key-press-event', (_, event) => {
            switch (event.get_key_symbol()) {
              case Clutter.KEY_f:
              case Clutter.KEY_slash:
                this.show_mode__search();
                return Clutter.EVENT_STOP;
              default:
                return Clutter.EVENT_PROPAGATE;
            }
        });
        this.global_mode_icon.connect('clicked', () => {
            if (this.current_mode.name === StatsMode.GLOBAL) {
                return Clutter.EVENT_PROPAGATE;
            } else if (this.prev_mode.name === StatsMode.GLOBAL) {
                this.show_mode__global(...this.prev_mode.args);
            } else {
                this.show_mode__global(MISC_UTILS.date_yyyymmdd());
            }

            return Clutter.EVENT_STOP;
        });
        this.hot_mode_icon.connect('clicked', () => {
            if (this.current_mode.name === StatsMode.HOT) {
                return Clutter.EVENT_PROPAGATE;
            } else if (this.prev_mode.name === StatsMode.HOT) {
                this.show_mode__hot(...this.prev_mode.args);
            } else {
                this.show_mode__hot(this.string_date_map.get('week')[0],
                                    this.string_date_map.get('week')[1]);
            }

            return Clutter.EVENT_STOP;
        });
        this.entry.clutter_text.connect('activate', () => {
            if (this.selected_search_result) {
                let d     = new Date();
                let label = this.selected_search_result.label_actor.get_text();
                let type  = this.selected_search_result.type;
                this.show_mode__single(d.getFullYear(), d.getMonth(), label, type);
            }
        });
        this.entry.clutter_text.connect('text-changed', () => this._search());
        this.entry.connect('key-release-event', (_, event) => this._maybe_navigate_search_results(event.get_key_symbol()));
        this.heatmap_graph.connect('square-clicked', (_, square_label) => this._on_heatmap_clicked(square_label));
        this.single_mode_icon.connect('clicked', () => this.show_mode__search());
        this.heatmap_icon.connect('clicked', () => this._toggle_heatmap());
        this.graph_interval_icon.connect('clicked', () => this._toggle_show_intervals());
        this.range_btn.connect('clicked', () => this.range_menu.toggle());
        this.type_btn.connect('clicked', () => this.type_menu.toggle());
        this.ext.connect('custom-css-changed', () => this._on_custom_css_updated());
        this.date_picker.connect('date-changed', (_, ...args) => this._on_date_picker_changed(...args));
    }

    set_stats (stats_data, stats_unique_tasks, stats_unique_projects, oldest_date) {
        this.stats_data            = stats_data;
        this.stats_unique_tasks    = Array.from(stats_unique_tasks);
        this.stats_unique_projects = Array.from(stats_unique_projects);

        let today = MISC_UTILS.date_yyyymmdd();

        this.date_picker.set_range(oldest_date,  today);
        this.bound_date_1.set_range(oldest_date, today);
        this.bound_date_2.set_range(oldest_date, today);

        this._update_string_date_map();
    }

    // @date: string
    show_mode__global (date) {
        let actors = [
            this.inner_middle_box,
            this.vbars_graph.actor,
            this.date_picker.actor,
            this.heatmap_icon,
            this.heatmap_graph.actor,
            this.graph_interval_icon,
        ];

        this._set_mode(StatsMode.GLOBAL, [date], () => {
            actors.forEach((it) => it.hide());
            this.vbars_graph.draw_vbars([], 8, 64);
        });

        this.middle_box.vertical = true;
        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        this.global_mode_icon.checked = true;
        this.date_picker.set_date_from_string(date);

        this.heatmap_graph.params.selected_square_rgba = this.custom_css['-timepp-heatmap-selected-color'][1];
        this.heatmap_graph.actor.visible = this.heatmap_icon.checked;

        if (this.heatmap_icon.checked) {
            if (this.prev_mode.name !== this.current_mode.name ||
                this.prev_mode.args[0].substr(0, 4) !== date.substr(0, 4)) {

                this.heatmap_graph.update_params(this._get_stats__heatmap());
                this._update_heatmap_selected_square(date);
                this.heatmap_graph.draw_heatmap();
            } else {
                this._update_heatmap_selected_square(date);
                this.heatmap_graph.draw_heatmap();
            }
        }

        if (this.prev_mode.name !== this.current_mode.name) {
            this.vbars_graph.draw_coord_system({
                y_max               : 86400,
                y_conversion_factor : 3600,
                n_rulers            : 12,
                x_offset            : 40,
                y_offset            : 0,
                y_label_format_func : (y_val) => '%02d:00'.format(y_val),
            });
        }

        this.vbars_graph.draw_vbars(
            this._get_stats__vbars_global(date),
            8,
            64,
            (vbar, interval_idx) => this._tooltip_format(vbar, interval_idx)
        );
    }

    // @year  : int
    // @month : int (0-indexed)
    // @label : string (a project or task)
    // @type  : string ('()' or '++');
    show_mode__single (year, month, label, type) {
        let actors = [
            this.inner_middle_box,
            this.stats_card,
            this.date_picker.actor,
            this.heatmap_icon,
            this.heatmap_graph.actor,
            this.vbars_graph.actor,
            this.graph_interval_icon,
        ];

        this._set_mode(StatsMode.SINGLE, [year, month, label, type], () => {
            actors.forEach((it) => it.hide());
            this.date_picker.day_picker.actor.show();
            this.vbars_graph.draw_vbars([], 8, 64);
        });

        this.middle_box.vertical = false;
        this.date_picker.day_picker.actor.visible = false;
        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        this.single_mode_icon.checked = true;

        this.heatmap_graph.params.selected_square_rgba = this.custom_css['-timepp-heatmap-selected-color'][1];
        this.heatmap_graph.actor.visible = this.heatmap_icon.checked;

        if (this.heatmap_icon.checked) {
            if (this.prev_mode.name !== this.current_mode.name ||
                this.prev_mode.args[0] !== year ||
                this.prev_mode.args[2] !== label) {

                this.heatmap_graph.update_params(this._get_stats__heatmap(label));
            }

            let date = MISC_UTILS.date_yyyymmdd(new Date(year, month));
            this._update_heatmap_selected_square(date);
            this.heatmap_graph.draw_heatmap();
        }

        this.date_picker.set_date(year, month, 1);

        this.vbars_graph.draw_coord_system({
            y_max               : 86400,
            y_conversion_factor : 3600,
            n_rulers            : 12,
            x_offset            : 40,
            y_offset            : 20,
            y_label_format_func : (y_val) => '%02d:00'.format(y_val),
        });

        this.vbars_graph.draw_vbars(
            this._get_stats__vbars_single(year, month, label, type),
            8,
            64,
            (vbar, interval_idx) => this._tooltip_format(vbar, interval_idx)
        );


        //
        // update stats card
        //
        if (this.prev_mode.name === StatsMode.SINGLE && this.prev_mode.args[2] === label)
            return;


        //
        // title
        //
        let markup;

        if (type === '()') markup = `<b>${_('Stats for task')}:</b>`;
        else               markup = `<b>${_('Stats for project')}:</b>`;

        markup += '\n\n' + label.replace(/\\n/g, '\n');

        this.stats_card_title.clutter_text.set_markup(
            MISC_UTILS.markdown_to_pango(markup, this.ext.markdown_map));


        //
        // global stats
        //
        let stats = this._get_stats__sum(label);

        markup = '\n\n\n';

        for (let [k, v] of this.string_date_map) {
            let time_str = '%dh %dmin %ds'.format(
                Math.floor(stats[k][0] / 3600),
                Math.floor(stats[k][0] % 3600 / 60),
                stats[k][0] % 60
            );

            let day_str = '';

            if (k !== 'today' && stats[k][0] > 0)
                day_str = ` (${ngettext('%d day', '%d days', stats[k][1]).format(stats[k][1])})`;

            markup += `<b>${v[0]}:</b>\n  ${time_str}${day_str}\n\n`;
        };


        //
        // yearly quarters
        //
        markup += `\n\n<b>${_('Total time per year quarter')}:</b>`;

        for (let [year, quarters] of stats.quarters) {
            markup += '\n';

            quarters.forEach((it, i) => {
                let time_str = '%dh %dmin %ds'.format(
                    Math.floor(it[0] / 3600),
                    Math.floor(it[0] % 3600 / 60),
                    it[0] % 60
                );

                let day_str = '';

                if (it[1] > 0)
                    day_str = ` (${ngettext('%d day', '%d days', it[1]).format(it[1])})`;

                markup += `\n<b>Q${i + 1} ${year}:</b> ${time_str}${day_str}`;
            });
        }

        this.stats_card_stats.clutter_text.set_markup(`<tt>${markup}</tt>`);
    }

    // @label : string (description of range)
    // @range : array  (of the form [date_str_1, date_str_2])
    show_mode__hot (label, range) {
        let actors = [
            this.inner_middle_box,
            this.vbars_graph.actor,
            this.hot_mode_control_box,
        ];

        this._set_mode(StatsMode.HOT, [label, range], () => {
            actors.forEach((it) => {
                it.hide()
                this.vbars_graph.draw_vbars([], 8, 64);
            });
        });

        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => { it.checked = false; });
        this.hot_mode_icon.checked = true;

        let lower_bound, upper_bound;

        if (range[0] <= range[1]) {
            lower_bound = range[0];
            upper_bound = range[1];
        } else {
            lower_bound = range[1];
            upper_bound = range[0];
        }

        let n_days_in_range = (new Date(upper_bound)) - (new Date(lower_bound));
        n_days_in_range     = Math.round(n_days_in_range / 86400000) + 1;

        {
            this.range_btn.label = `${label}  (${ngettext('%d day', '%d days', n_days_in_range).format(n_days_in_range)})`;
            let hot_mode_type    = this.delegate.settings.get_enum('todo-hot-mode-type');
            this.type_btn.label  = hot_mode_type === HotMode.TASK ? _('Tasks') : _('Projects');
        }

        let vbars = this._get_stats__vbars_hot(lower_bound, upper_bound);

        let max_hours = 24;
        if (vbars.length > 0) max_hours = Math.floor(vbars[0].info.total_time / 3600);

        if (max_hours <= 24) {
            this.vbars_graph.draw_coord_system({
                y_max               : 86400,
                y_conversion_factor : 3600,
                n_rulers            : 12,
                x_offset            : 30,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        } else if (max_hours < 100) {
            let y_max = 3600 * ((max_hours - max_hours % 5) + 5);
            this.vbars_graph.draw_coord_system({
                y_max               : y_max,
                y_conversion_factor : 3600,
                n_rulers            : Math.floor(y_max / (3600 * 5)),
                x_offset            : 30,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        } else if (max_hours < 200) {
            let y_max = 3600 * ((max_hours - max_hours % 10) + 10);
            this.vbars_graph.draw_coord_system({
                y_max               : y_max,
                y_conversion_factor : 3600,
                n_rulers            : Math.floor(y_max / (3600 * 10)),
                x_offset            : 30,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        } else if (max_hours < 300) {
            let y_max = 3600 * ((max_hours - max_hours % 20) + 20);
            this.vbars_graph.draw_coord_system({
                y_max               : y_max,
                y_conversion_factor : 3600,
                n_rulers            : Math.floor(y_max / (3600 * 20)),
                x_offset            : 30,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        } else if (max_hours < 1000) {
            let y_max = 3600 * ((max_hours - max_hours % 50) + 50);
            this.vbars_graph.draw_coord_system({
                y_max               : y_max,
                y_conversion_factor : 3600,
                n_rulers            : Math.floor(y_max / (3600 * 50)),
                x_offset            : 40,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        } else {
            let i = 1000;
            for (; max_hours >= i; i *= 10);
            i /= 100;

            let y_max = 3600 * ((max_hours - max_hours % i) + i);
            this.vbars_graph.draw_coord_system({
                y_max               : y_max,
                y_conversion_factor : 3600,
                n_rulers            : Math.floor(y_max / (3600 * i)),
                x_offset            : 60,
                y_offset            : 0,
                y_label_format_func : (y_val) => y_val + '',
            });
        }

        this.vbars_graph.draw_vbars(vbars, 8, 64, (vbar) => {
            return this._tooltip_format_hot_mode(vbar, n_days_in_range);
        });
    }

    show_mode__search () {
        let actors = [this.entry, this.search_results_container];

        this._set_mode(StatsMode.SEARCH, null, () => {
            this.selected_search_result = null;
            this.task_results.scrollbox.destroy_all_children();
            this.project_results.scrollbox.destroy_all_children();
            this.task_results.box.hide();
            this.project_results.box.hide();
            actors.forEach((it) => it.hide());
            this.single_mode_icon.show();
            this.top_box.layout_manager.homogeneous = false;
            this.entry.set_text('');
        });

        actors.forEach((it) => it.show());
        this.single_mode_icon.hide();
        this.top_box.layout_manager.homogeneous = true; // centers the entry
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        Mainloop.idle_add(() => this.entry.grab_key_focus());
    }

    show_mode__banner (text) {
        this._set_mode(StatsMode.BANNER, null, () => {
            this.set_banner_size(0);
            this.nav_bar.show();
        });

        this.nav_bar.hide();
        this.set_banner_size(.2);
        this.set_banner_text(text);
    }

    // A very simple way of handling different 'modes' (views) of the stats
    // interface.
    //
    // There is one 'show_mode__' func for each mode, which needs to call this
    // func.
    //
    // We maintain the args passed to a particular 'show_mode__' func so that
    // it's possible to refresh the mode by calling it with the same args
    // (e.g., when the css custom props have been updated.) Or we could slightly
    // tweak the args and refresh (e.g., change the keyword, but keep month
    // the same for the SINGLE mode.)
    //
    // @mode_name     : string (use StatsMode enum only)
    // @args          : array  (of the args passed to a 'show_mode__' func)
    // @hide_callback : func   (used to close the prev mode)
    _set_mode (name, args, hide_callback) {
        this.prev_mode = this.current_mode;

        this.current_mode = {
            name          : name,
            args          : args,
            hide_callback : hide_callback,
        };

        if (typeof this.prev_mode.hide_callback === 'function') {
            let focused_actor = this.prev_mode.name === this.current_mode.name ?
                                global.stage.get_key_focus() :
                                this.actor;

            this.prev_mode.hide_callback();
            Mainloop.idle_add(() => focused_actor.grab_key_focus());
        }
    }

    _get_stats__heatmap (label) {
        let res = {
            matrix      : [[], [], [], [], [], [], []],
            matrix_size : [7, 0],
            row_labels  : [],
            col_labels  : [],
        };

        let selected_year = this.date_picker.get_date()[0][0];
        let date = new Date(selected_year, 0, 1, 12, 0, 0);

        // row labels
        date.setDate(2);
        res.row_labels.push([1, date.toLocaleFormat('%a')]);
        date.setDate(4);
        res.row_labels.push([3, date.toLocaleFormat('%a')]);
        date.setDate(6);
        res.row_labels.push([5, date.toLocaleFormat('%a')]);
        date.setDate(1);

        let row = 0;
        let col = 0;

        let color_map = [
            this.custom_css['-timepp-heatmap-color-A'][1],
            this.custom_css['-timepp-heatmap-color-B'][1],
            this.custom_css['-timepp-heatmap-color-C'][1],
            this.custom_css['-timepp-heatmap-color-D'][1],
            this.custom_css['-timepp-heatmap-color-E'][1],
            this.custom_css['-timepp-heatmap-color-F'][1],
        ];

        res.col_labels.push([0, date.toLocaleFormat('%b')]);

        while (date.getFullYear() === selected_year) {
            let day      = date.getDate();
            let yyyymmdd = MISC_UTILS.date_yyyymmdd(date);
            let rgba     = color_map[5];
            let time     = 0;

            if (day === 1 && col > 0) {
                col += 2;
                res.matrix.forEach((row) => row.push(0, 0));
                res.col_labels.push([col, date.toLocaleFormat('%b')]);
            }

            let records = this.stats_data.get(yyyymmdd);

            if (records) {
                if (label) {
                    for (let record of records)
                        if (record.label === label) time += record.total_time;
                } else {
                    for (let record of records)
                        if (record.type === '()') time += record.total_time;
                }

                // in seconds
                if      (time === 0)   rgba = color_map[5];
                else if (time < 3600)  rgba = color_map[4];
                else if (time < 10800) rgba = color_map[3];
                else if (time < 21600) rgba = color_map[2];
                else if (time < 25200) rgba = color_map[1];
                else                   rgba = color_map[0];
            }

            res.matrix[row].push({
                label : yyyymmdd + ' ' + time,
                rgba  : rgba,
            });

            row++;

            if (row === 7) {
                row = 0;
                col++;
            }

            date.setDate(day + 1);
        }

        res.matrix_size[1] = col;

        return res;
    }

    _get_stats__sum (keyword) {
        let sum = {
            today        : [0, 0],
            week         : [0, 0],
            month        : [0, 0],
            three_months : [0, 0],
            six_months   : [0, 0],
            quarters     : new Map(),
            all          : [0, 0],
        };

        let month_quarter_map = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3];

        let bound_dates = new Map([
            ['today'        , this.string_date_map.get('today')[1][0]],
            ['week'         , this.string_date_map.get('week')[1][0]],
            ['month'        , this.string_date_map.get('month')[1][0]],
            ['three_months' , this.string_date_map.get('three_months')[1][0]],
            ['six_months'   , this.string_date_map.get('six_months')[1][0]],
        ]);

        this.stats_data.forEach((records, date) => {
            let val = null;

            for (let record of records) {
                if (record.label === keyword) {
                    val = record.total_time;
                    break;
                }
            }

            let day = val ? 1 : 0;

            bound_dates.forEach((target_date, k) => {
                if (date >= target_date) {
                    sum[k][0] += val;
                    sum[k][1] += day;
                } else {
                    bound_dates.delete(k);
                }
            });

            if (!day) return;

            sum.all[0] += val;
            sum.all[1] += day;

            let year          = date.substr(0, 4);
            let quarter       = month_quarter_map[+(date.substr(5, 2))];
            let year_quarters = sum.quarters.get(year) || [[0, 0], [0, 0], [0, 0], [0, 0]];

            year_quarters[quarter][0] += val;
            year_quarters[quarter][1] += 1;

            sum.quarters.set(year, year_quarters);
        });

        return sum;
    }

    _get_stats__vbars_hot (lower_bound, upper_bound) {
        let stats = [];

        let hot_mode_type = this.delegate.settings.get_enum('todo-hot-mode-type');
        hot_mode_type     = hot_mode_type === HotMode.TASK ? '()' : '++';

        for (let [date, records] of this.stats_data) {
            if (date < lower_bound) break;
            if (date > upper_bound) continue;

            for (let record of records) {
                if (record.type !== hot_mode_type) continue;

                let found = false;

                for (let stat of stats) {
                    if (stat.label === record.label) {
                        stat.total_time += record.total_time;
                        stat.n_work_days++;
                        found = true;
                        break;
                    }
                }

                if (! found) {
                    stats.push({
                        label         : record.label,
                        type          : record.type,
                        total_time    : record.total_time,
                        n_work_days   : 1,
                        has_intervals : false,
                    });
                }
            }
        }

        stats.sort((a, b) => +(a.total_time < b.total_time) || +(a.total_time === b.total_time) - 1);

        let rgba;
        if (hot_mode_type === '()') rgba = this.custom_css['-timepp-task-vbar-color'][1];
        else                        rgba = this.custom_css['-timepp-proj-vbar-color'][1];

        let max_vbars = Math.min(stats.length, 100);
        let vbars     = new Array(max_vbars);

        for (let i = 0; i < max_vbars; i++) {
            vbars[i] = {
                info      : stats[i],
                intervals : [[0, stats[i].total_time]],
                rgba      : rgba,
                x_label   : '',
            };
        }

        return vbars;
    }

    _get_stats__vbars_single (year, month, label, type) {
        month++; // make it 1-indexed

        let show_intervals = this.delegate.settings.get_boolean('todo-graph-shows-intervals');

        // NOTE: The way getting the num of days works is that setting the day
        // to 0 will decrement the month and set the day to the last day.
        let days_in_month = (new Date(year, month, 0)).getDate();

        let rgba;

        if (type === '()') rgba = this.custom_css['-timepp-task-vbar-color'][1];
        else               rgba = this.custom_css['-timepp-proj-vbar-color'][1];

        let vbars = new Array(days_in_month);

        for (let i = 0; i < days_in_month; i++) {
            let records = this.stats_data.get('%d-%02d-%02d'.format(year, month, i+1));

            if (!records) {
                vbars[i] = {
                    info      : null,
                    intervals : [],
                    rgba      : rgba,
                    x_label   : '%02d'.format(i+1),
                };

                continue;
            }

            for (let r of records) {
                if (r.label !== label) continue;

                let info = {
                    label         : r.label,
                    type          : r.type,
                    total_time    : r.total_time,
                    has_intervals : true,
                };

                let intervals;

                if (!show_intervals || !r.intervals) {
                    intervals = [[0, r.total_time]];
                    info.has_intervals = false;
                } else {
                    intervals = this._interval_stoa(r.intervals);
                }

                vbars[i] = {
                    info      : info,
                    intervals : intervals,
                    rgba      : rgba,
                    x_label   : '%02d'.format(i+1),
                };
            }

            if (!vbars[i]) {
                vbars[i] = {
                    info      : null,
                    intervals : [],
                    rgba      : rgba,
                    x_label   : '%02d'.format(i+1),
                };
            }
        }

        return vbars;
    }

    _get_stats__vbars_global (date) {
        let vbars   = [];
        let records = this.stats_data.get(date);

        if (! records) return vbars;

        let show_intervals = this.delegate.settings.get_boolean('todo-graph-shows-intervals');

        for (let record of records) {
            let rgba;

            if (record.type === '()') rgba = this.custom_css['-timepp-task-vbar-color'][1];
            else                      rgba = this.custom_css['-timepp-proj-vbar-color'][1];

            let info = {
                label         : record.label,
                type          : record.type,
                total_time    : record.total_time,
                has_intervals : true,
            };

            let intervals;

            if (!show_intervals || !record.intervals) {
                intervals = [[0, record.total_time]];
                info.has_intervals = false;
            } else {
                intervals = this._interval_stoa(record.intervals);
            }

            vbars.push({
                info      : info,
                intervals : intervals,
                rgba      : rgba,
                x_label   : '',
            });
        }

        return vbars;
    }

    _interval_stoa (interval_str) {
        let res = [];

        for (let interval of interval_str.split('||')) {
            let i = [];
            res.push(i);

            for (let bound of interval.split('..')) {
                let [h, m, s] = bound.split(':');
                i.push(+(h)*3600 + +(m)*60 + +(s));
            }
        }

        return res;
    }

    _tooltip_format_hot_mode (vbar, n_days_in_range) {
        let total_time_str = '%dh %dmin %ds'.format(
            Math.floor(vbar.info.total_time / 3600),
            Math.floor(vbar.info.total_time % 3600 / 60),
            vbar.info.total_time % 60
        );

        let avg_including_off_days = Math.round(vbar.info.total_time / n_days_in_range);
        let avg_excluding_off_days = Math.round(vbar.info.total_time / vbar.info.n_work_days);

        let time_str = '%dh %dmin %ds'.format(
            Math.floor(avg_including_off_days / 3600),
            Math.floor(avg_including_off_days % 3600 / 60),
            avg_including_off_days % 60
        );
        avg_including_off_days =
            `${_('Average per day (including off days)')}: ${time_str} ` +
            `(${ngettext('%d day', '%d days', n_days_in_range).format(n_days_in_range)})`;

        time_str = '%dh %dmin %ds'.format(
            Math.floor(avg_excluding_off_days / 3600),
            Math.floor(avg_excluding_off_days % 3600 / 60),
            avg_excluding_off_days % 60
        );
        avg_excluding_off_days =
            `${_('Average per day (excluding off days)')}: ${time_str} ` +
            `(${ngettext('%d day', '%d days', n_days_in_range).format(vbar.info.n_work_days)})`;

        return `- ${_('Total')}: ${total_time_str}\n\n` +
               `- ${avg_excluding_off_days}\n\n` +
               `- ${avg_including_off_days}\n\n` +
               `${vbar.info.label.replace(/\\n/g, '\n')}`;
    }

    // used in single and global modes
    _tooltip_format (vbar, interval_idx) {
        let txt = '';

        txt += '- ' + _('Total') + ': %dh %dmin %ds'.format(
            Math.floor(vbar.info.total_time / 3600),
            Math.floor(vbar.info.total_time % 3600 / 60),
            vbar.info.total_time % 60
        );

        let show_intervals = this.delegate.settings.get_boolean('todo-graph-shows-intervals');

        if (!show_intervals) {
            // nothing
        } else if (vbar.info.has_intervals) {
            let interval = vbar.intervals[interval_idx];

            let start = '%02d:%02d:%02d'.format(
                Math.floor(interval[0] / 3600),
                Math.floor(interval[0] % 3600 / 60),
                interval[0] % 60
            );

            let end = '%02d:%02d:%02d'.format(
                Math.floor(interval[1] / 3600),
                Math.floor(interval[1] % 3600 / 60),
                interval[1] % 60
            );

            let delta = interval[1] - interval[0];
            delta = '%dh %dmin %ds'.format(
                Math.floor(delta / 3600),
                Math.floor(delta % 3600 / 60),
                delta % 60
            );

            txt += `\n\n- ${_('Interval')}: ${start}..${end} (${delta})`;
        } else {
            txt += '\n\n- ' + _('No intervals found.');
        }

        txt += '\n\n' + vbar.info.label.replace(/\\n/g, '\n');

        return txt;
    }

    _toggle_show_intervals () {
        let current = this.delegate.settings.get_boolean('todo-graph-shows-intervals');

        if (current) {
            this.graph_interval_icon.get_first_child().gicon = MISC_UTILS.getIcon('timepp-graph-symbolic');
            this.delegate.settings.set_boolean('todo-graph-shows-intervals', false);
        } else {
            this.graph_interval_icon.get_first_child().gicon = MISC_UTILS.getIcon('timepp-graph-intervals-symbolic');
            this.delegate.settings.set_boolean('todo-graph-shows-intervals', true);
        }

        if (this.current_mode.name === StatsMode.GLOBAL || this.current_mode.name === StatsMode.SINGLE)
            this.mode_func_map[this.current_mode.name](...this.current_mode.args);
    }

    _toggle_heatmap () {
        if (this.current_mode.name !== StatsMode.GLOBAL &&
            this.current_mode.name !== StatsMode.SINGLE)
            return;

        if (this.heatmap_graph.actor.visible) {
            this.heatmap_icon.checked = false;
            this.heatmap_graph.actor.visible = false;
            this.delegate.settings.set_boolean('todo-stats-heatmap-visible', false);
        } else {
            this.heatmap_icon.checked = true;
            this.heatmap_graph.actor.visible = true;
            this.delegate.settings.set_boolean('todo-stats-heatmap-visible', true);

            let params;

            if (this.current_mode.name === StatsMode.SINGLE) {
                params = this._get_stats__heatmap(this.current_mode.args[2]);
            } else {
                params = this._get_stats__heatmap();
            }

            this.heatmap_graph.draw_heatmap(params);
        }
    }

    // @key_symbol: a clutter key symbol
    _maybe_navigate_search_results (key_symbol) {
        if (!this.task_results.box.visible && !this.project_results.box.visible)
            return;

        let direction;
        if      (key_symbol === Clutter.KEY_Up)    direction = 1;
        else if (key_symbol === Clutter.KEY_Down)  direction = 2;
        else if (key_symbol === Clutter.KEY_Right) direction = 3;
        else if (key_symbol === Clutter.KEY_Left)  direction = 4;
        if (! direction) return;

        let new_selected;
        if      (direction === 1) new_selected = this.selected_search_result.label_actor.get_previous_sibling();
        else if (direction === 2) new_selected = this.selected_search_result.label_actor.get_next_sibling();
        else if (direction === 3) new_selected = this.project_results.scrollbox.get_first_child();
        else if (direction === 4) new_selected = this.task_results.scrollbox.get_first_child();
        if (! new_selected) return;

        this.selected_search_result.label_actor.pseudo_class = '';
        new_selected.pseudo_class   = 'selected';
        this.selected_search_result = new_selected._delegate;

        let parents;
        if (new_selected._delegate.type === '()') parents = [this.task_results.scrollview, this.task_results.scrollbox];
        else                                      parents = [this.project_results.scrollview, this.project_results.scrollbox];

        MISC_UTILS.scroll_to_item(parents[0], parents[1], new_selected);
    }

    _search () {
        this.task_results.scrollbox.destroy_all_children();
        this.project_results.scrollbox.destroy_all_children();
        this.task_results.box.hide();
        this.project_results.box.hide();
        this.task_results.scrollview.get_vscroll_bar().get_adjustment().set_value(0);
        this.project_results.scrollview.get_vscroll_bar().get_adjustment().set_value(0);

        let needle = this.entry.get_text().toLowerCase();

        if (! needle) return;

        let tasks    = this.stats_unique_tasks;
        let projects = this.stats_unique_projects;

        let reduced_task_results    = [];
        let reduced_project_results = [];

        for (let i = 0, len = tasks.length; i < len; i++) {
            let score = FUZZ.fuzzy_search_v1(needle, tasks[i].toLowerCase());
            if (score !== null) reduced_task_results.push([i, score]);
        }

        reduced_task_results.sort((a, b) => b[1] - a[1]);

        for (let i = 0, len = projects.length; i < len; i++) {
            let score = FUZZ.fuzzy_search_v1(needle, projects[i].toLowerCase());
            if (score !== null) reduced_project_results.push([i, score]);
        }

        reduced_project_results.sort((a, b) => b[1] - a[1]);

        this.task_results.box.visible = reduced_task_results.length > 0;
        this.project_results.box.visible = reduced_project_results.length > 0;

        if (reduced_project_results.length === 0 && reduced_task_results.length === 0)
            return;

        let results = [
            [reduced_task_results, this.stats_unique_tasks],
            [reduced_project_results, this.stats_unique_projects],
        ];

        for (let j = 0; j < 2; j++) {
            let reduced = results[j][0];
            let stats   = results[j][1];
            let type    = (j === 0) ? '()' : '++';

            for (let i = 0, len = Math.min(50, reduced.length); i < len; i++) {
                let item = { type: type};

                let label = new St.Label({ text: stats[reduced[i][0]], reactive: true, track_hover: true, style_class: 'search-result-item' });
                label.clutter_text.line_wrap      = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                label.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

                item.label_actor = label;
                label._delegate  = item;

                label.connect('allocation-changed', () => {
                    if (type === '()') {
                        if (!this.task_results.scrollview.vscrollbar_visible)
                            MISC_UTILS.resize_label(label);
                    } else if (!this.project_results.scrollview.vscrollbar_visible) {
                        MISC_UTILS.resize_label(label);
                    }
                });
                label.connect('notify::hover', () => {
                    if (this.selected_search_result)
                        this.selected_search_result.label_actor.pseudo_class = '';

                    label.pseudo_class = 'selected';

                    this.selected_search_result = {
                        label_actor : label,
                        type        : type,
                    };
                });
                label.connect('button-press-event', () => {
                    let d = new Date();
                    this.show_mode__single(d.getFullYear(), d.getMonth(), label.get_text(), type);
                });

                if (type === '()') this.task_results.scrollbox.add_child(label);
                else               this.project_results.scrollbox.add_child(label);
            }
        }

        {
            let item = this.task_results.scrollbox.get_first_child();
            if (!item) item = this.project_results.scrollbox.get_first_child()

            item = item._delegate;
            item.label_actor.pseudo_class = 'selected';

            this.selected_search_result = {
                label_actor : item.label_actor,
                type        : item.type,
            };
        }
    }

    _on_date_picker_changed (new_date_arr, new_date_str, old_date_arr, old_date_str) {
        if (this.current_mode.name === StatsMode.GLOBAL) {
            this.show_mode__global(new_date_str);
        } else if (this.current_mode.name === StatsMode.SINGLE) {
            this.show_mode__single(new_date_arr[0], new_date_arr[1], this.current_mode.args[2], this.current_mode.args[3]);
        }
    }

    _update_heatmap_selected_square (date) {
        let m = this.heatmap_graph.params.matrix;
        let square, d;

        for (let i = 0; i < m.length; i++) {
            for (let j = 0; j < m[i].length; j++) {
                square = m[i][j];

                if (! square) continue;

                [d, ] = square.label.split(' ');

                if (d === date) {
                    this.heatmap_graph.selected_square     = square;
                    this.heatmap_graph.selected_square_pos = [j, i];
                    return;
                }
            }
        }
    }

    _update_string_date_map () {
        let today  = MISC_UTILS.date_yyyymmdd();
        let [oldest, ] = this.date_picker.get_range();
        let date_o = new Date(today + 'T00:00:00');

        this.string_date_map.get('all')[1] = [oldest, today];

        this.string_date_map.get('today')[1] = [today, today];

        let day_pos = (7 - Shell.util_get_week_start() + date_o.getDay()) % 7;
        date_o.setDate(date_o.getDate() - day_pos);
        this.string_date_map.get('week')[1] = [MISC_UTILS.date_yyyymmdd(date_o), today];

        date_o.setDate(1);
        this.string_date_map.get('month')[1] = [today.substr(0, 7) + '-01', today];

        date_o.setMonth(date_o.getMonth() - 2);
        this.string_date_map.get('three_months')[1] = [MISC_UTILS.date_yyyymmdd(date_o), today];

        date_o.setMonth(date_o.getMonth() - 3);
        this.string_date_map.get('six_months')[1] = [MISC_UTILS.date_yyyymmdd(date_o), today];
    }

    _on_heatmap_clicked (square_label) {
        let [date, time] = square_label.split(' ');

        if (this.current_mode.name === StatsMode.GLOBAL) {
            this.show_mode__global(date);
        }
        else if (this.current_mode.name === StatsMode.SINGLE) {
            let [year, month, day] = date.split('-');

            this.current_mode.args[0] = +(year);
            this.current_mode.args[1] = +(month) - 1;

            this.show_mode__single(...this.current_mode.args);
        }
    }

    _on_custom_css_updated () {
        this.vbars_graph.draw_coord_system({
            axes_rgba     : this.custom_css['-timepp-axes-color'][1],
            y_label_rgba  : this.custom_css['-timepp-y-label-color'][1],
            x_label_rgba  : this.custom_css['-timepp-x-label-color'][1],
            vbars_bg_rgba : this.custom_css['-timepp-vbar-bg-color'][1],
            rulers_rgba   : this.custom_css['-timepp-rulers-color'][1],
        });

        if (this.current_mode.name)
            this.mode_func_map[this.current_mode.name](...this.current_mode.args);
    }

    _on_new_day_started (today) {
        let [lower,] = this.date_picker.get_range();

        this.date_picker.set_range(lower,  today);
        this.bound_date_1.set_range(lower, today);
        this.bound_date_2.set_range(lower, today);

        this._update_string_date_map();
    }

    close () {
        this.stats_data            = null;
        this.stats_unique_tasks    = null;
        this.stats_unique_projects = null;

        this._set_mode('', null, null);

        super.close();
    }

    destroy () {
        if (this.new_day_sig_id) this.delegate.disconnect(this.new_day_sig_id);

        this.type_menu.destroy();
        this.range_menu.destroy();

        super.destroy();
    }
}
