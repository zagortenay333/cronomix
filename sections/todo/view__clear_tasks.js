const St      = imports.gi.St;
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
// @@@ ViewClearTasks
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//   - 'delete-all'  (delete all completed tasks)
//   - 'archive-all' (delete and write to done.txt all completed tasks)
//   - 'cancel'
// =====================================================================
var ViewClearTasks = new Lang.Class({
    Name: 'Timepp.ViewClearTasks',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box clear-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // options
        //
        this.delete_all_item = new St.BoxLayout({ reactive: true, style_class: 'row' });
        this.content_box.add_child(this.delete_all_item);

        this.delete_all_label = new St.Label ({ text: _('Delete all completed tasks'), y_align: Clutter.ActorAlign.CENTER, style_class: 'delete-completed-tasks-label' });
        this.delete_all_item.add(this.delete_all_label, {expand: true});

        this.delete_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.delete_all_item.add_child(this.delete_all_radiobutton);

        let delete_all_checkmark = new St.Bin();
        this.delete_all_radiobutton.add_actor(delete_all_checkmark);


        this.archive_all_item = new St.BoxLayout({ reactive: true, style_class: 'row' });
        this.content_box.add_child(this.archive_all_item);

        this.archive_all_label = new St.Label ({ text: _('Archive all completed tasks to done.txt and delete them'), y_align: Clutter.ActorAlign.CENTER, style_class: 'archive-all-completed-tasks-label' });
        this.archive_all_item.add(this.archive_all_label, {expand: true});

        this.archive_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.archive_all_item.add_child(this.archive_all_radiobutton);

        let archive_all_checkmark = new St.Bin();
        this.archive_all_radiobutton.add_actor(archive_all_checkmark);

        let done_file = this.delegate.settings.get_value('todo-current')
                            .deep_unpack().done_file;

        if (!done_file) {
            this.archive_all_item.hide();
            this.delete_all_radiobutton.checked = true;
        }
        else {
            this.archive_all_radiobutton.checked = true;
        }


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button notification-icon-button modal-dialog-button' });
        this.btn_box.add(this.button_cancel, {expand: true});

        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button notification-icon-button modal-dialog-button' });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.archive_all_radiobutton.connect('clicked', () => {
            this.delete_all_radiobutton.checked = false;
        });
        this.delete_all_radiobutton.connect('clicked', () => {
            let done_file = this.delegate.settings.get_value('todo-current')
                                .deep_unpack().done_file;

            if (!done_file) {
                this.delete_all_radiobutton.checked = true;
                return;
            }

            this.archive_all_radiobutton.checked = false;
        });
        this.button_ok.connect('clicked',  () => {
            if (this.delete_all_radiobutton.checked)
                this.emit('delete-all');
            else
                this.emit('archive-all');
        });
        this.button_cancel.connect('clicked', () => { this.emit('cancel'); });
    },
});
Signals.addSignalMethods(ViewClearTasks.prototype);
