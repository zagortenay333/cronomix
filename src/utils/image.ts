import St from 'gi://St';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Fs from './fs.js';
import { Button } from './button.js';
import { show_info_popup } from './popup.js';

export class Image {
    actor: St.Widget;

    constructor (path: string, default_width: number, fixed_width?: number) {
        try {
            if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);

            let width: number;

            if (fixed_width) {
                width = fixed_width;
            } else {
                [,width] = GdkPixbuf.Pixbuf.get_file_info(path);
                if (width === 0) throw 0;
                if (width > default_width) width = default_width;
            }

            const p       = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, width, -1, true);
            const format  = p.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
            const content = St.ImageContent.new_with_preferred_size(p.width, p.height);
            const context = global.stage.context.get_backend().get_cogl_context();
            content.set_bytes(context, p.read_pixel_bytes(), format, p.width, p.height, p.rowstride);

            this.actor = new St.Widget({ height: p.height, width: p.width });
            this.actor.set_content(content);
            this.actor.set_content_gravity(Clutter.ContentGravity.CENTER);
            this.actor.reactive = true;
            this.actor.connect('button-press-event', () => Fs.open_file_in_default_app(path));
            this.actor.connect('enter-event', () => global.display.set_cursor(5));
            this.actor.connect('leave-event', () => global.display.set_cursor(2));
        } catch (e) {
            const button = new Button({ icon: 'cronomix-issue-symbolic', label: _('Image not found'), style_class: 'cronomix-red' });
            button.subscribe('left_click', () => show_info_popup(button, '' + e));
            this.actor = button.actor;
        }
    }
}
