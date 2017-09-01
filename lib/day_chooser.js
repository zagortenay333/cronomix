const St      = imports.gi.St;
const Shell   = imports.gi.Shell;
const Clutter = imports.gi.Clutter;
const Lang    = imports.lang;

const MSECS_IN_DAY = 24 * 60 * 60 * 1000;


// =====================================================================
// @@@ A day picker widget
//
// @checked: bool (true = all days selected, false = no days selected)
// =====================================================================
var DayChooser = new Lang.Class({
    Name: 'Timepp.DayChooser',

    _init: function (checked) {
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'row days' });

        let week_start = Shell.util_get_week_start();
        let iter       = new Date();
        iter.setSeconds(0); // leap second protection
        iter.setHours(12);

        for (let i = 0; i < 7; i++) {
            let day_pos = (7 - week_start + iter.getDay()) % 7;

            let btn = new St.Button({ label       : iter.toLocaleFormat('%a'),
                                      toggle_mode : true,
                                      checked     : checked,
                                      can_focus   : true,
                                      x_expand    : true,
                                      style_class : 'day button', });

            if (checked) btn.add_style_pseudo_class('active');

            this.actor.insert_child_at_index(btn, day_pos);

            iter.setTime(iter.getTime() + MSECS_IN_DAY);

            btn.connect('clicked', () => {
                if (btn.checked) btn.add_style_pseudo_class('active');
                else             btn.remove_style_pseudo_class('active');
            });
        }
    }
});
