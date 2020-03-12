const St      = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main    = imports.ui.main;
const Signals = imports.signals;
const GObject    = imports.gi.GObject

const ME = imports.misc.extensionUtils.getCurrentExtension();
const MISC_UTILS      = ME.imports.lib.misc_utils;


// =====================================================================
// @@@ DatePicker
//
// @lower_bound_str : string (in iso yyyy-mm-dd format. E.g., 2000-01-01)
// @upper_bound_str : string (in iso yyyy-mm-dd format. E.g., 2000-01-01)
// @labels          : array of str [year_label, month_label, day_label]
// @do_wrap         : bool
//
// @signals:
//   - 'date-changed' (returns @date_arr and @date_str)
//       @date_arr: array  (of ints [year, month, day]. Month is 0-indexed)
//       @date_str: string (in yyyy-mm-dd format)
// =====================================================================
var DatePicker = class DatePicker{
    constructor (lower_bound_str, upper_bound_str, labels, do_wrap) {
        this.lower_bound_str = lower_bound_str;
        this.upper_bound_str = upper_bound_str;
        this.do_wrap         = do_wrap;

        this.lower_bound = null; // null or array of int [year, month, day]
        this.upper_bound = null; // null or array of int [year, month, day]

        this.set_range(lower_bound_str, upper_bound_str);


        // currently selected date
        this.date = new Date();


        //
        // actor
        //
        this.actor = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style_class: 'date-picker' });


        //
        // pickers
        //
        this.year_picker = new DatePickerItem(labels[0]);
        this.actor.add_actor(this.year_picker.actor);

        this.month_picker = new DatePickerItem(labels[1]);
        this.actor.add_actor(this.month_picker.actor);

        this.day_picker = new DatePickerItem(labels[2]);
        this.actor.add_actor(this.day_picker.actor);


        this._update_pickers();


        //
        // listen
        //
        this.year_picker.connect('changed',  (_, direction) => {
            this._on_date_changed('y', direction);
        });
        this.month_picker.connect('changed', (_, direction) => {
            this._on_date_changed('m', direction);
        });
        this.day_picker.connect('changed',   (_, direction) => {
            this._on_date_changed('d', direction);
        });
    }

    // @date: string (in iso yyyy-mm-dd format)
    set_date_from_string (date) {
        this.date.setFullYear(+(date.substr(0, 4)));
        this.date.setMonth(+(date.substr(5, 2) - 1));
        this.date.setDate(+(date.substr(8, 2)));

        this._update_pickers();
    }

    // @year  : int
    // @month : int (0-indexed)
    // @day   : int
    set_date (year, month, day) {
        this.date.setFullYear(year);
        this.date.setMonth(month);
        this.date.setDate(day);

        this._update_pickers();
    }

    get_date () {
        let date = [
            this.date.getFullYear(),
            this.date.getMonth(),
            this.date.getDate(),
        ];

        let date_str = '%d-%02d-%02d'.format(date[0], date[1] + 1, date[2]);

        return [date, date_str];
    }

    get_range () {
        return [this.lower_bound_str, this.upper_bound_str];
    }

    // @lower_bound_str : string (in iso yyyy-mm-dd format)
    // @upper_bound_str : string (in iso yyyy-mm-dd format)
    set_range (lower_bound_str, upper_bound_str) {
        this.lower_bound_str = lower_bound_str;
        this.upper_bound_str = upper_bound_str;
        this.lower_bound     = null;
        this.upper_bound     = null;

        if (lower_bound_str) {
            this.lower_bound = [
                +(lower_bound_str.substr(0, 4)),
                +(lower_bound_str.substr(5, 2)) - 1,
                +(lower_bound_str.substr(8, 2)),
            ];
        }

        if (upper_bound_str) {
            this.upper_bound = [
                +(upper_bound_str.substr(0, 4)),
                +(upper_bound_str.substr(5, 2)) - 1,
                +(upper_bound_str.substr(8, 2)),
            ];
        }
    }

    _update_pickers () {
        this.year_picker.counter.text  = '' + this.date.getFullYear();
        this.month_picker.counter.text = '%02d'.format(this.date.getMonth() + 1);
        this.day_picker.counter.text   = '%02d'.format(this.date.getDate());
    }

    // @ymd       : one of ['y', 'm', 'd'] (1=year, 2=month, 3=day)
    // @direction : one of [1, -1]         (increment or decrement)
    _on_date_changed (ymd, direction) {
        let prev_date = [
            this.date.getFullYear(),
            this.date.getMonth(),
            this.date.getDate(),
        ];

        let prev_date_str =
            '%d-%02d-%02d'.format(prev_date[0], prev_date[1] + 1, prev_date[2]);

        switch (ymd) {
          case 'y':
            this.date.setFullYear(prev_date[0] + direction);
            break;
          case 'm':
            this.date.setMonth(prev_date[1] + direction);
            break;
          case 'd':
            this.date.setDate(prev_date[2] + direction);
            break;
        }

        let new_date = [
            this.date.getFullYear(),
            this.date.getMonth(),
            this.date.getDate(),
        ];

        let new_date_str = '%d-%02d-%02d'.format(new_date[0], new_date[1] + 1, new_date[2]);

        let below = this.lower_bound_str && new_date_str < this.lower_bound_str;
        let above = this.upper_bound_str && new_date_str > this.upper_bound_str;

        if (below) {
            if (this.do_wrap && this.upper_bound) {
                new_date     = this.upper_bound;
                new_date_str = this.upper_bound_str;
            } else {
                new_date     = this.lower_bound;
                new_date_str = this.lower_bound_str;
            }
        } else if (above) {
            if (this.do_wrap && this.lower_bound) {
                new_date     = this.lower_bound;
                new_date_str = this.lower_bound_str;
            } else {
                new_date     = this.upper_bound;
                new_date_str = this.upper_bound_str;
            }
        }

        if (new_date_str !== prev_date_str) {
            this.emit('date-changed', new_date, new_date_str, prev_date, prev_date_str);
        }

        this.date.setFullYear(new_date[0]);
        this.date.setMonth(new_date[1]);
        this.date.setDate(new_date[2]);

        this._update_pickers();
    }
}
Signals.addSignalMethods(DatePicker.prototype);



// =====================================================================
// @@@ Date Picker Item
//
// @label: string
//
// @signals: 'changed' (returns 1 or -1)
// =====================================================================
var DatePickerItem = class DatePickerItem {
    constructor (label) {
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'date-picker-item' });


        //
        // label
        //
        if (label) {
            this.label = new St.Label({ text: label, x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
            this.actor.add_child(this.label);
        }


        //
        // counter label
        //
        this.counter = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this.counter);


        //
        // arrows
        //
        let arrow_box = new St.BoxLayout({ vertical: true });
        this.actor.add_child(arrow_box);

        this.btn_up = new St.Button({ can_focus: true, style_class: 'arrow-btn' });
        arrow_box.add_actor(this.btn_up);
        this.btn_up.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-pan-up-symbolic') }));

        this.btn_down = new St.Button({ can_focus: true, style_class: 'arrow-btn' });
        arrow_box.add_actor(this.btn_down);
        this.btn_down.add_actor(new St.Icon({ gicon : MISC_UTILS.getIcon('timepp-pan-down-symbolic') }));


        //
        // listen
        //
        this.btn_up.connect('button-press-event', (_, event) => {
            this._on_press_event(event, 1);
        });
        this.btn_up.connect('key-press-event', (_, event) => {
            this._on_press_event(event, 1);
        });
        this.btn_down.connect('button-press-event', (_, event) => {
            this._on_press_event(event, -1);
        });
        this.btn_down.connect('key-press-event', (_, event) => {
            this._on_press_event(event, -1);
        });
        this.actor.connect('scroll-event', (_, event) => {
            switch (event.get_scroll_direction()) {
              case Clutter.ScrollDirection.UP:
                this.emit('changed', 1);
                break;
              case Clutter.ScrollDirection.DOWN:
                this.emit('changed', -1);
                break;
            }
        });
    }

    _on_press_event (event, increment) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_PRIMARY) {

            this.emit('changed', increment);
        }
        else if (event.type() === Clutter.EventType.KEY_PRESS) {
            let key_id = event.get_key_symbol();

            if (key_id === Clutter.KEY_space || key_id === Clutter.KEY_Return)
                this.emit('changed', increment);
        }
    }
}
Signals.addSignalMethods(DatePickerItem.prototype);
