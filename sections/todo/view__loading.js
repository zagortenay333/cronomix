const St      = imports.gi.St;
const Meta    = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const Main    = imports.ui.main;
const Lang    = imports.lang;
const Signals = imports.signals;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ ViewLoading
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
// =====================================================================
var ViewLoading = new Lang.Class({
    Name: 'Timepp.ViewLoading',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        //
        // draw
        //
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'view-loading' });

        this.loading_msg = new St.Label({ text: _('Loading...')});
        this.actor.add_child(this.loading_msg);
    },

    close: function () {
        this.actor.destroy();
    },
});
Signals.addSignalMethods(ViewLoading.prototype);
