const St       = imports.gi.St;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();
const MISC_UTILS = ME.imports.lib.misc_utils;


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
var ViewClearTasks = class ViewClearTasks {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        //
        // container
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-clear-tasks view-box' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // options
        //
        {
            this.delete_all_item = new St.BoxLayout({ reactive: true, style_class: 'row delete-completed-tasks' });
            this.content_box.add_child(this.delete_all_item);

            this.delete_all_item.add(new St.Icon ({ gicon : MISC_UTILS.getIcon('timepp-radioactive-symbolic') }));
            this.delete_all_item.add(new St.Label ({ text: _('Delete all completed tasks'), x_expand: true, y_align: Clutter.ActorAlign.CENTER }));

            this.delete_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
            this.delete_all_item.add_child(this.delete_all_radiobutton);

            let delete_all_checkmark = new St.Bin();
            this.delete_all_radiobutton.add_actor(delete_all_checkmark);
        }

        {
            this.archive_all_item = new St.BoxLayout({ reactive: true, style_class: 'row rchive-all-completed-tasks-label' });
            this.content_box.add_child(this.archive_all_item);

            this.archive_all_item.add(new St.Label ({ text: _('Archive all completed tasks to done.txt and delete them'), x_expand: true, y_align: Clutter.ActorAlign.CENTER }));

            this.archive_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
            this.archive_all_item.add_child(this.archive_all_radiobutton);

            let archive_all_checkmark = new St.Bin();
            this.archive_all_radiobutton.add_actor(archive_all_checkmark);

            let current = this.delegate.get_current_todo_file();
            if (current && current.done_file) {
                this.archive_all_radiobutton.checked = true;
            } else {
                this.archive_all_item.hide();
                this.delete_all_radiobutton.checked = true;
            }
        }


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);

        this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
        this.btn_box.add(this.button_delete, {expand: true});

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button notification-icon-button modal-dialog-button' });
        this.btn_box.add(this.button_cancel, {expand: true});


        //
        // listen
        //
        this.archive_all_radiobutton.connect('clicked', () => { this.delete_all_radiobutton.checked = false; });
        this.delete_all_radiobutton.connect('clicked', () => { this.archive_all_radiobutton.checked = false; });
        this.button_cancel.connect('clicked', () => { this.emit('cancel'); });
        this.button_delete.connect('clicked',  () => {
            if (this.delete_all_radiobutton.checked)
                this.emit('delete-all');
            else
                this.emit('archive-all');
        });
    }

    close () {
        this.actor.destroy();
    }
}
Signals.addSignalMethods(ViewClearTasks.prototype);
