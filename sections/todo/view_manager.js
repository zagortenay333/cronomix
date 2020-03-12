const Gtk      = imports.gi.Gtk;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;

const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();

const MISC_UTILS = ME.imports.lib.misc_utils;

const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ View Manager
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// - The todo section is always in a particular view.
// - A view must be enlisted in the View enum.
// - To switch to a new view, use the show_view function of this object.
// - The current_view is always stored in the current_view var of this obj.
// =====================================================================
var ViewManager = class ViewManager {
    constructor (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.lock      = false;
        this.container = this.delegate.actor;

        this.reset();
    }

    reset () {
        this.current_view           = null;
        this.current_view_name      = "";
        this.actors                 = [];
        this.open_callback          = null;
        this.close_callback         = null;
        this.show_tasks_mainloop_id = null;
    }

    close_current_view () {
        if (typeof this.close_callback === 'function') this.close_callback();
        this.reset();
    }

    // @view_params: object of the form: { view           : object
    //                                     view_name      : View
    //                                     actors         : array
    //                                     focused_actors : object
    //                                     close_callback : func
    //                                     open_callback  : func }
    //
    // @view:
    //   The main object of the view. Can be used by the main view to call some
    //   methods on it.
    //
    // @view_name:
    //   
    //
    // @actors (can be omitted if @open_callback is given):
    //   Array of all the top-level actors that need to be in the popup
    //   menu. These are the actors that make up the particular view.
    //
    // @focused_actor:
    //   Actor that will be put into focus when the view is shown.
    //
    // @close_callback:
    //   Function that is used to close this view when another view needs
    //   to be shown.
    //
    // @open_callback (optional):
    //   Function that is used to open the view. If it is not given, then
    //   opening the view means that the actors will be added to the popup menu.
    show_view (view_params) {
        if (typeof this.close_callback === 'function') this.close_callback();

        this.current_view      = view_params.view || null;
        this.current_view_name = view_params.view_name;
        this.actors            = view_params.actors;
        this.close_callback    = view_params.close_callback;
        this.open_callback     = view_params.open_callback || null;

        if (typeof this.open_callback === 'function') {
            this.open_callback();
        } else {
            this.container.remove_all_children();

            // @HACK: Seems to speed things up when written like this...
            for (let actor of this.actors) actor.hide();
            for (let actor of this.actors) this.container.add_actor(actor);
            for (let actor of this.actors) actor.show();
        }

        if (view_params.focused_actor && this.ext.menu.isOpen) {
            view_params.focused_actor.grab_key_focus();
        }
    }
}
Signals.addSignalMethods(ViewManager.prototype);
