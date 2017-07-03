const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const Layout    = imports.ui.layout;
const PopupMenu = imports.ui.popupMenu;
const Lang      = imports.lang;
const Signals   = imports.signals;


// =====================================================================
// Fullscreen container
//
// @monitor: int
//
// signals: 'monitor-changed'
// =====================================================================
const Fullscreen = new Lang.Class({
    Name: 'Timepp.Fullscreen',

    _init: function (monitor) {
        this.is_open                        = false;
        this.monitor                        = monitor;
        this.prev_banner_length             = 0;
        this.banner_size                    = 1;
        this.banner_container_handler_block = true;
        this.monitor_constraint             = new Layout.MonitorConstraint();
        this.monitor_constraint.index       = monitor;


        //
        // draw
        //
        this.actor = new St.BoxLayout({ reactive: true, style_class: 'timepp-fullscreen' })
        this.actor.add_constraint(this.monitor_constraint);

        this.content_box = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, style_class: 'content' });
        this.actor.add_actor(this.content_box);

        this.menu_manager = new PopupMenu.PopupMenuManager(this);


        //
        // top box
        //
        this.top_box = new St.BoxLayout({ style_class: 'top-box' });
        this.content_box.add_actor(this.top_box);

        // monitor button/popup
        this.monitor_button = new St.Button({ reactive: true, can_focus: true, style_class: 'monitor-icon' });
        this.top_box.add_actor(this.monitor_button);
        let monitor_icon = new St.Icon({ icon_name: 'video-display-symbolic' });
        this.monitor_button.add_actor(monitor_icon);

        this.monitors_menu = new PopupMenu.PopupMenu(this.monitor_button, 0.5, St.Side.TOP);
        this.menu_manager.addMenu(this.monitors_menu);
        Main.uiGroup.add_actor(this.monitors_menu.actor);
        this.monitors_menu.actor.hide();
        this._update_monitors_menu();

        // expander
        this.top_box_expander = new St.BoxLayout({ x_expand: true });
        this.top_box.add_actor(this.top_box_expander);

        // close button
        this.close_button = new St.Button({ can_focus: true, style_class: 'close-icon' });
        this.top_box.add_actor(this.close_button);
        let close_icon = new St.Icon({ icon_name: 'window-close-symbolic', style_class: 'close-icon' });
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
            global.screen.connect('monitors-changed', () => {
                this._update_monitor_position(this.monitor);
                this._update_monitors_menu();
            });
        this.banner_container.connect('allocation-changed', () => {
            if (this.banner_container_handler_block)
                return;

            this._fit_banner(true);
        });
        this.monitors_menu.connect('open-state-changed', (_, state) => {
            this.monitor_button.checked = state;
        });
        this.monitor_button.connect('button-press-event', () => {
            this.monitors_menu.toggle();
        });
        this.close_button.connect('clicked', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('enter-event', () => {
            this.actor.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-press-event', () => {
            this.actor.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-press-event', (_, event) => {
            let symbol = event.get_key_symbol();

            if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            else if (symbol === Clutter.KEY_Tab) {
                let t = this.actor.navigate_focus(global.stage.get_key_focus(), Gtk.DirectionType.TAB_FORWARD, true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    },

    destroy: function () {
        if (this.monitor_change_id) {
            global.screen.disconnect(this.monitor_change_id);
            this.monitor_change_id = null;
        }

        this.actor.destroy();
    },

    close: function () {
        if (! this.is_open) return;

        this.is_open = false;

        this.banner_container_handler_block = true;
        Main.layoutManager.removeChrome(this.actor);
    },

    open: function () {
        if (this.is_open) {
            this.actor.grab_key_focus();
            this.actor.raise_top();
            return;
        }

        this.is_open = true;

        Main.layoutManager.addChrome(this.actor);
        this.actor.grab_key_focus();
        this._fit_banner(true);
        this.banner_container_handler_block = false;
        this.actor.raise_top();
    },

    _update_monitor_position: function (n) {
        if (n < global.screen.get_n_monitors()) {
            this.monitor_constraint.index = n;
            this.monitor = n;
            this.emit('monitor-changed', n);
        }
        else {
            this.monitor_constraint.index = global.screen.get_current_monitor();
        }
    },

    _update_monitors_menu: function () {
        let n_monitors = global.screen.get_n_monitors();
        let primary_monitor = global.screen.get_primary_monitor();

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

            let n = i;
            this.monitors_menu.addAction(txt + ': ' + n, () => {
                this._update_monitor_position(n);
            });
        }
    },

    set_banner_size: function (perc) {
        perc = Math.min(Math.max(perc, 0), 1);

        this.banner_size = perc;

        if (perc === 0) {
            this.banner.hide();
            return;
        }

        this.banner.show();

        let banner_container_alloc = this.banner_container.get_allocation_box();
        let banner_container_width = banner_container_alloc.x2 - banner_container_alloc.x1;

        let border_width = Math.floor(
            (banner_container_width - (banner_container_width * perc)) / 2);

        this.banner_container.style = 'padding: 0 %dpx;'.format(border_width);

        this._fit_banner(true);
    },

    set_banner_text: function (text) {
        this.banner.clutter_text.set_markup('<tt>' + text + '</tt>');

        // Since the banner is a monospaced font, we only need to recompute the
        // font size if the number of chars has changed.
        // Also, because it's monospaced, we can set it first to a dummy string
        // consisting only of spaces, compute the font size and then set the
        // actual text.
        if (this.is_open &&
            this.banner.visible &&
            text.length !== this.prev_banner_length) {

            this._fit_banner(true);
        }

        this.prev_banner_length = text.length;
    },

    _fit_banner: function (is_monospaced) {
        let container = this.banner_container;
        let label     = this.banner;
        let text      = this.banner.text;


        //
        // approximate
        //
        label.style = 'font-size: ' + 16 + 'px;';

        // We set text size to 0 before we get the container height to make sure
        // that the container hasn't been streched beyond it's natural size.
        // This function will not stretch the container. Instead, x_expand and
        // y_expand should be used on the banner container.
        label.text = '';

        let container_node   = container.get_theme_node();
        let container_alloc  = container.get_allocation_box();
        let container_width  = container_alloc.x2 - container_alloc.x1;
        let container_height = container_alloc.y2 - container_alloc.y1;
        container_width      = container_node.adjust_for_width(container_width);
        container_height     = container_node.adjust_for_height(container_height);

        if (is_monospaced) {
            let dummy_text = text.replace(/\S/g, ' ');
            label.clutter_text.set_markup('<tt>' + dummy_text + '</tt>');
        }
        else {
            label.clutter_text.set_markup(text);
        }

        let label_node         = label.get_theme_node();
        let [mw, label_width]  = label.clutter_text.get_preferred_width(-1);
        let [mh, label_height] = label.clutter_text.get_preferred_height(-1);
        [, label_width]        = label_node.adjust_preferred_width(mw, label_width);
        [, label_height]       = label_node.adjust_preferred_height(mh, label_height);

        let font_size;

        let height_diff = container_height - label_height;
        let width_diff  = container_width  - label_width;

        if (width_diff >= height_diff) {
            font_size = Math.floor(container_height / label_height) * 16;
        }
        else {
            font_size = Math.floor(container_width / label_width) * 16;
        }

        label.style = 'font-size: ' + font_size + 'px;';


        //
        // find perfect font size
        //
        label_node         = label.get_theme_node();
        [mw, label_width]  = label.clutter_text.get_preferred_width(-1);
        [mh, label_height] = label.clutter_text.get_preferred_height(-1);
        [, label_width]    = label_node.adjust_preferred_width(mw, label_width);
        [, label_height]   = label_node.adjust_preferred_height(mh, label_height);

        let modifier    = 64;
        let prev_height = label_height;
        let curr_state;
        let prev_state = label_height > container_height ||
                         label_width  > container_width ;

        while (true) {
            curr_state = label_height > container_height ||
                         label_width  > container_width ;

            if (curr_state !== prev_state) {
                modifier /= 2;

                if (modifier === 1) {
                    if (curr_state) { // one final correction
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

            label_node         = label.get_theme_node();
            [mw, label_width]  = label.clutter_text.get_preferred_width(-1);
            [mh, label_height] = label.clutter_text.get_preferred_height(-1);
            [, label_width]    = label_node.adjust_preferred_width(mw, label_width);
            [, label_height]   = label_node.adjust_preferred_height(mh, label_height);

            // This is a safety measure.
            // If the label's height didn't change as a result of the font
            // change, then the actor is most probably not rendered/visible and
            // the loop would run forever as a result.
            // This ensures that this function can be safely called even when
            // the label is not drawn.
            if (label_height === prev_height) break;

            prev_height = label_height;
        }

        if (is_monospaced) label.clutter_text.set_markup('<tt>'+ text +'</tt>');
    },
});
Signals.addSignalMethods(Fullscreen.prototype);
