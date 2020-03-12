const St       = imports.gi.St;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


// =====================================================================
// @@@ ViewLoading
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
var ViewLoading = class ViewLoading {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.view_lock = true;


        //
        // draw
        //
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'view-loading timepp-menu-item' });

        this.loading_msg = new St.Label({ text: _('Loading...'), style_class: 'loading-msg' });
        this.actor.add_child(this.loading_msg);
    }

    close () {
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewLoading.prototype);
