const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Pango     = imports.gi.Pango;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const Layout    = imports.ui.layout;
const PopupMenu = imports.ui.popupMenu;

const Signals   = imports.signals;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const MISC = ME.imports.lib.misc_utils;


// =====================================================================
// @@@ Fullscreen
//
// @monitor: int
//
// signals: 'monitor-changed', 'closed', 'opened'
// =====================================================================
var Fullscreen = class Fullscreen{
    constructor (monitor) {
        this.is_open                        = false;
        this.monitor                        = monitor;
        this.prev_banner_length             = 0;
        this.banner_markup                  = '...';
        this.banner_size                    = 1;
        this.banner_container_handler_block = true;
        this.banner_size_update_needed      = true;
        this.banner_refit_needed            = true;
        this.monitor_constraint             = new Layout.MonitorConstraint();
        this.monitor_constraint.index       = monitor;
        this.display                        = MISC.global_wrapper.display;


        //
        // container
        //
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'timepp-fullscreen' })
        this.actor.add_constraint(this.monitor_constraint);

        this.content_box = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, style_class: 'content' });
        this.actor.add_actor(this.content_box);


        //
        // menu
        //
        this.menu_manager = new PopupMenu.PopupMenuManager(this.actor);


        //
        // top box
        //
        this.top_box = new St.Widget({ layout_manager: new Clutter.BoxLayout(), style_class: 'top-box' });
        this.content_box.add_actor(this.top_box);

        this.top_box_left = new St.BoxLayout({ x_align: Clutter.ActorAlign.START, x_expand: true });
        this.top_box.add_actor(this.top_box_left);

        this.top_box_center = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, x_expand: true });
        this.top_box.add_actor(this.top_box_center);

        this.top_box_right = new St.BoxLayout({ x_align: Clutter.ActorAlign.END,  x_expand: true });
        this.top_box.add_actor(this.top_box_right);

        // monitor button/popup
        this.monitor_button = new St.Button({ reactive: true, can_focus: true, style_class: 'monitor-icon' });
        this.top_box_left.add_actor(this.monitor_button);
        let monitor_icon = new St.Icon({ gicon : MISC.getIcon('timepp-monitor-symbolic') });
        this.monitor_button.add_actor(monitor_icon);

        this.monitors_menu = new PopupMenu.PopupMenu(this.monitor_button, 0.5, St.Side.TOP);
        this.menu_manager.addMenu(this.monitors_menu);
        Main.uiGroup.add_actor(this.monitors_menu.actor);
        this.monitors_menu.actor.hide();
        this._update_monitors_menu();

        // close button
        this.close_button = new St.Button({ can_focus: true, style_class: 'close-icon' });
        this.top_box_right.add_actor(this.close_button);
        let close_icon = new St.Icon({ gicon : MISC.getIcon('timepp-close-symbolic') });
        this.close_button.add_actor(close_icon);


        //
        // middle box
        //
        this.middle_box = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, style_class: 'middle-box' });
        this.content_box.add_actor(this.middle_box);

        this.banner_container = new St.Bin({ x_expand: true, y_expand: true, style_class: 'banner-container' });
        this.middle_box.add_actor(this.banner_container);
        this.banner = new St.Label({ x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'banner-label' });
        this.banner_container.add_actor(this.banner);


        //
        // bottom box
        //
        this.bottom_box = new St.BoxLayout({ vertical: true, style_class: 'bottom-box'});
        this.content_box.add_actor(this.bottom_box);


        //
        // listen
        //
        this.monitor_change_id =
            Main.layoutManager.connect('monitors-changed', () => {
                this._update_monitor_position(this.monitor);
                this._update_monitors_menu();
            });
        this.osd_keyboard_id =
            Main.layoutManager.connect('keyboard-visible-changed', (_, state) => {
                if (this.open && state)
                    Main.layoutManager.keyboardBox.raise_top();
            });
        this.banner_container.connect('allocation-changed', () => {
            if (this.open && !this.banner_container_handler_block)
                this._fit_banner();
        });
        this.monitors_menu.connect('open-state-changed', (_, state) => {
            this.monitor_button.checked = state;
        });
        this.monitor_button.connect('clicked', () => {
            this.monitors_menu.toggle();
        });
        this.close_button.connect('clicked', () => {
            this.close();
        });
        this.actor.connect('enter-event', () => {
            if (this.display.get_current_monitor() !== this.monitor)
                this.actor.grab_key_focus();
        });
        this.actor.connect('button-press-event', () => {
            this.actor.grab_key_focus();
        });
        this.actor.connect('key-press-event', (_, event) => {
            let symbol = event.get_key_symbol();

            if (symbol === Clutter.KEY_Escape) {
                this.close();
            } else if (symbol === Clutter.KEY_Tab) {
                let direction = Gtk.DirectionType.TAB_FORWARD;

                if (event.get_state() === Clutter.ModifierType.CONTROL_MASK)
                    direction = Gtk.DirectionType.TAB_BACKWARD;

                this.actor.navigate_focus(global.stage.get_key_focus(), direction, true);
            }
        });
    }

    destroy () {
        if (this.monitor_change_id) {
            Main.layoutManager.disconnect(this.monitor_change_id);
            this.monitor_change_id = null;
        }

        if (this.osd_keyboard_id) {
            Main.layoutManager.disconnect(this.osd_keyboard_id);
            this.osd_keyboard_id = null;
        }

        this.monitors_menu.destroy();
        this.actor.destroy();
    }

    close () {
        if (! this.is_open) return;

        this.is_open = false;
        this.banner_container_handler_block = true;
        Main.layoutManager.removeChrome(this.actor);

        this.emit('closed');
    }

    open () {
        if (this.is_open) {
            this.actor.grab_key_focus();
            this.actor.raise_top();
            return;
        }

        this.is_open = true;
        Main.layoutManager.addChrome(this.actor);
        this.actor.grab_key_focus();
        this.banner_container_handler_block = false;
        this.actor.raise_top();

        if (this.banner_size_update_needed) this._update_banner_size();

        this.emit('opened');
    }

    _update_monitor_position (n) {
        if (n < this.display.get_n_monitors()) {
            this.monitor_constraint.index = n;
            this.monitor = n;
            this.emit('monitor-changed', n);
        } else {
            this.monitor_constraint.index = this.display.get_current_monitor();
        }
    }

    _update_monitors_menu () {
        let n_monitors = this.display.get_n_monitors();
        let primary_monitor = this.display.get_primary_monitor();

        this.monitors_menu.removeAll();

        if (n_monitors === 1) {
            this.monitor_button.hide();
            return;
        }

        this.monitor_button.show();

        let txt = _('Move to Primary Monitor') + ': ' + primary_monitor;

        this.monitors_menu.addAction(txt, () => {
            this._update_monitor_position(primary_monitor);
        });

        txt = _('Move to Secondary Monitor');

        for (let i = 0; i < n_monitors; i++) {
            if (i === primary_monitor) continue;

            this.monitors_menu.addAction(txt + ': ' + i, () => {
                this._update_monitor_position(i);
            });
        }
    }

    set_banner_text (markup) {
        this.banner_markup = markup;

        // Since the banner is a monospaced font, we only need to recompute the
        // font size if the number of chars has changed.
        if (this.is_open && this.banner_container.visible && markup.length !== this.prev_banner_length) {
            this._fit_banner();
        } else {
            this.banner.clutter_text.set_markup('<tt>' + markup + '</tt>');
        }

        this.prev_banner_length = markup.length;
    }

    // @perc: num [0, 1] (percentage of width the text will occupy)
    set_banner_size (perc) {
        perc = Math.min(Math.max(perc, 0), 1);

        if (this.banner_size === perc) return;

        this.banner_size = perc;
        this.banner_size_update_needed = true;
        this._update_banner_size();
    }

    _update_banner_size () {
        if (!this.is_open) return;

        this.banner_size_update_needed = false;

        if (this.banner_size === 0) {
            this.banner_container.hide();
            return;
        }

        this.banner_container.show();

        let alloc = this.banner_container.get_allocation_box();
        let banner_container_w = alloc.x2 - alloc.x1;

        let border_width = Math.floor(
            (banner_container_w - (banner_container_w * this.banner_size)) / 2);

        this.banner_container.style = `padding: 0 ${border_width}px;`;

        this._fit_banner();
    }

    _fit_banner (caller) {
        this.banner_container_handler_block = true;

        let container = this.banner_container;
        let label     = this.banner;


        //
        // approximate
        //
        this.banner.clutter_text.set_markup('<tt>' + this.banner_markup + '</tt>');
        label.style = 'font-size: 16px;';

        let container_node  = container.get_theme_node();
        let container_alloc = container.get_allocation_box();
        let container_w     = container_alloc.x2 - container_alloc.x1;
        let container_h     = container_alloc.y2 - container_alloc.y1;
        container_w         = container_node.adjust_for_width(container_w);
        container_h         = container_node.adjust_for_height(container_h);

        let label_node    = label.get_theme_node();
        let [mw, label_w] = label.clutter_text.get_preferred_width(-1);
        let [mh, label_h] = label.clutter_text.get_preferred_height(-1);
        [, label_w]       = label_node.adjust_preferred_width(mw, label_w);
        [, label_h]       = label_node.adjust_preferred_height(mh, label_h);

        let font_size;

        let height_diff = container_h - label_h;
        let width_diff  = container_w - label_w;

        if (width_diff >= height_diff) font_size = Math.floor(container_h / label_h) * 16;
        else                           font_size = Math.floor(container_w / label_w) * 16;

        label.style = 'font-size: ' + font_size + 'px;';


        //
        // After approximating, find perfect font size.
        //
        label_node    = label.get_theme_node();
        [mw, label_w] = label.clutter_text.get_preferred_width(-1);
        [mh, label_h] = label.clutter_text.get_preferred_height(-1);
        [, label_w]   = label_node.adjust_preferred_width(mw, label_w);
        [, label_h]   = label_node.adjust_preferred_height(mh, label_h);

        let modifier    = 64;
        let prev_height = label_h;
        let prev_state  = label_h > container_h || label_w  > container_w ;
        let curr_state;

        while (true) {
            curr_state = label_h > container_h || label_w  > container_w ;

            if (curr_state !== prev_state) {
                modifier /= 2;

                if (modifier === 1) {
                    if (curr_state) { // final correction
                        font_size -= modifier * 2;
                        label.style = 'font-size: ' + font_size + 'px;';
                    }

                    break;
                }
            }

            prev_state = curr_state;

            if (curr_state) font_size -= modifier;
            else            font_size += modifier;

            label.style = 'font-size: ' + font_size + 'px;';

            label_node    = label.get_theme_node();
            [mw, label_w] = label.clutter_text.get_preferred_width(-1);
            [mh, label_h] = label.clutter_text.get_preferred_height(-1);
            [, label_w]   = label_node.adjust_preferred_width(mw, label_w);
            [, label_h]   = label_node.adjust_preferred_height(mh, label_h);

            if (label_h === prev_height) break; // Guard against inf loop.

            prev_height = label_h;
        }

        this.banner_container_handler_block = false;
    }
}
Signals.addSignalMethods(Fullscreen.prototype);
