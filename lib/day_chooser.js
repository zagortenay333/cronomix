const St      = imports.gi.St;
const Shell   = imports.gi.Shell;
const Clutter = imports.gi.Clutter;


const MSECS_IN_DAY = 86400000;


// =====================================================================
// @@@ DayChooser
//
// @checked: bool (true = all days selected, false = no days selected)
// =====================================================================
var DayChooser = class DayChooser{
    constructor (checked) {
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'row days' });

        let week_start = Shell.util_get_week_start();
        let iter       = new Date();
        iter.setSeconds(0);
        iter.setHours(12);

        this.buttons = new Array(7);

        for (let i = 0; i < 7; i++) {
            let day     = iter.getDay();
            let day_pos = (7 - week_start + day) % 7;

            let btn = new St.Button({ label       : iter.toLocaleFormat('%a'),
                                      toggle_mode : true,
                                      checked     : checked,
                                      can_focus   : true,
                                      x_expand    : true,
                                      style_class : 'day button', });

            this.buttons[day] = btn;

            if (checked) btn.add_style_pseudo_class('active');

            this.actor.insert_child_at_index(btn, day_pos);

            iter.setTime(iter.getTime() + MSECS_IN_DAY);

            btn.connect('clicked', () => {
                if (btn.checked) btn.add_style_pseudo_class('active');
                else             btn.remove_style_pseudo_class('active');
            });
        }
    }

    // Returns array of ints of all days that are selected/checked. Sunday is 0.
    get_days () {
        let res = [];

        this.buttons.forEach((b, i) => {
            if (b.checked) res.push(i);
        });

        return res;
    }
}
