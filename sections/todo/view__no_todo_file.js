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
// @@@ ViewNoTodoFile
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
// =====================================================================
var ViewNoTodoFile = new Lang.Class({
    Name: 'Timepp.ViewNoTodoFile',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        //
        // draw
        //
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'view-no-todo-file' });

        this.no_todo_file_msg = new St.Label({ text: _('Select todo file in settings...') });
        this.actor.add_child(this.no_todo_file_msg);
    },

    close: function () {
        this.actor.destroy();
    },
});
Signals.addSignalMethods(ViewNoTodoFile.prototype);
