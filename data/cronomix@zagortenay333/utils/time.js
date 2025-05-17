import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { PubSub } from './pubsub.js';

export const Days = [
    ['sun', () => _('Sun')],
    ['mon', () => _('Mon')],
    ['tue', () => _('Tue')],
    ['wed', () => _('Wed')],
    ['thu', () => _('Thu')],
    ['fri', () => _('Fri')],
    ['sat', () => _('Sat')],
];

export const SpecialDatesTr = {
    get today() { return _('Today'); },
    get week() { return _('Week'); },
    get month() { return _('Month'); },
    get year() { return _('Year'); },
};

export class SpecialDates {
    today;
    week;
    month;
    year;
}

// Returns a date in the shape year-month-day.
export function get_iso_date(date = new Date()) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
        .toISOString()
        .split("T")[0];
}

export function get_special_dates() {
    const result = new SpecialDates();
    
    const iter = new Date();
    iter.setHours(0, 0, 0, 0);
    
    result.today = get_iso_date(iter);
    
    const dt = ((iter.getDay() - Shell.util_get_week_start()) + 7) % 7;
    iter.setDate(iter.getDate() - dt);
    result.week = get_iso_date(iter);
    
    iter.setDate(1);
    result.month = get_iso_date(iter);
    
    iter.setMonth(0);
    result.year = get_iso_date(iter);
    
    return result;
}

export function get_day() {
    const idx = new Date().getDay();
    return Days[idx][0];
}

export function get_time_ms() {
    return Math.floor(GLib.get_monotonic_time() / 1000);
}

export class Time {
    total;
    hours;
    minutes;
    seconds;
    cseconds;
    
    constructor(total) {
        this.total = total;
        this.cseconds = Math.floor(total / 10) % 100;
        this.seconds = Math.floor(total / 1000) % 60;
        this.minutes = Math.floor(total / 60000) % 60;
        this.hours = Math.floor(total / 3600000);
    }
    
    fmt_hm() {
        const h = this.hours.toString().padStart(2, '0');
        const m = this.minutes.toString().padStart(2, '0');
        return `${h}:${m}`;
    }
    
    fmt_hms(round_seconds_up = false) {
        const h = this.hours.toString().padStart(2, '0');
        const m = this.minutes.toString().padStart(2, '0');
        const a = (round_seconds_up && this.cseconds) ? 1 : 0;
        const s = (this.seconds + a).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    
    fmt_hmsc() {
        const h = this.hours.toString().padStart(2, '0');
        const m = this.minutes.toString().padStart(2, '0');
        const s = this.seconds.toString().padStart(2, '0');
        const c = this.cseconds.toString().padStart(2, '0');
        return `${h}:${m}:${s}.${c}`;
    }
}

export class WallClock extends PubSub {
    time;
    #tic_id = 0;
    
    constructor() {
        super();
        this.time = this.#get_time();
        this.#tic();
    }
    
    destroy() {
        this.unsubscribe_all();
        
        if (this.#tic_id) {
            GLib.source_remove(this.#tic_id);
            this.#tic_id = 0;
        }
    }
    
    #tic() {
        const time = this.#get_time();
        
        if (time > this.time) {
            this.time = time;
            this.publish('tic', this.time);
        }
        
        this.#tic_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this.#tic());
    }
    
    #get_time() {
        const date = new Date();
        return 60 * date.getHours() + date.getMinutes();
    }
}
