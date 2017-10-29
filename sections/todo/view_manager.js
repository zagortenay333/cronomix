const Gtk      = imports.gi.Gtk;
const Clutter  = imports.gi.Clutter;
const Main     = imports.ui.main;
const Lang     = imports.lang;
const Signals  = imports.signals;
const Mainloop = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


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
var ViewManager = new Lang.Class({
    Name: 'Timepp.ViewManager',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.current_view           = G.View.DEFAULT;
        this.actors                 = [];
        this.open_callback          = null;
        this.close_callback         = null;
        this.show_tasks_mainloop_id = null;

        // @SPEED
        this.delegate.connect('section-open-state-changed', (_, state) => {
            if (this.current_view === G.View.LOADING ||
                this.current_view === G.View.NO_TODO_FILE) {

                return Clutter.EVENT_PROPAGATE;
            }

            if (state) {
                if (this.delegate.tasks_scroll_wrapper.visible)
                    this._show_tasks();
            }
            else if (this.delegate.tasks_scroll_wrapper.visible) {
                this._hide_tasks();
            }

            return Clutter.EVENT_PROPAGATE;
        });
    },

    // @view:
    //   is an object of the form: { view_name      : View,
    //                               actors         : array,
    //                               focused_actors : object,
    //                               close_callback : func, }
    //
    // When calling this function all properties must be provided.
    //
    // @view_name:
    //   Name of the new view. Only use the View enum here.
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
    show_view: function (view) {
        if (this.delegate.tasks_scroll_wrapper.visible)
            this._hide_tasks();

        if (typeof this.close_callback === 'function')
            this.close_callback();

        this.current_view   = view.view_name;
        this.actors         = view.actors;
        this.close_callback = view.close_callback;
        this.open_callback  = view.open_callback || null;

        let show_tasks = false;

        if (typeof this.open_callback === 'function') {
            this.open_callback();
        }
        else {
            this.delegate.actor.remove_all_children();

            for (let i = 0; i < this.actors.length; i++) {
                this.delegate.actor.add_actor(this.actors[i]);
                this.actors[i].show();

                if (this.actors[i] === this.delegate.tasks_scroll_wrapper)
                    show_tasks = true;
            }
        }

        if (show_tasks) {
            if (this.delegate.tasks.length === 0)
                this.delegate.tasks_scroll_wrapper.hide();
            else
                this._show_tasks();
        }

        if (this.ext.menu.isOpen) view.focused_actor.grab_key_focus();
    },

    // @SPEED
    // Showing/adding actors to the popup menu can be somewhat laggy if there
    // are a lot of tasks. To speed things up a bit, each time we need to add,
    // show, hide, or remove actors from the popup menu, we first hide all
    // tasks, do the operation and then show the tasks again.
    //
    // Also, each time the popup menu closes, we hide the tasks, and show them
    // using this func after the menu opens.
    _show_tasks: function () {
        if (! this.ext.menu.isOpen) return;

        this.delegate.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.delegate.tasks_scroll.get_vscroll_bar().get_adjustment().set_value(0);

        let n = Math.min(this.delegate.tasks_viewport.length, 21);

        for (let i = 0; i < n; i++)
            this.delegate.tasks_viewport[i].actor.visible = true;

        this.show_tasks_mainloop_id = Mainloop.idle_add(() => {
           this._show_tasks__finish(n);
        });
    },

    _show_tasks__finish: function (i, scroll_bar_shown) {
        if (!scroll_bar_shown && this.ext.needs_scrollbar()) {
            this.delegate.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            scroll_bar_shown = true;
        }

        if (! this.ext.menu.isOpen ||
            i === this.delegate.tasks_viewport.length ||
            this.delegate.add_tasks_to_menu_mainloop_id) {

            this.show_tasks_mainloop_id = null;
            return;
        }

        this.delegate.tasks_viewport[i].actor.visible = true;

        this.show_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._show_tasks__finish(++i, scroll_bar_shown);
        });
    },

    _hide_tasks: function () {
        if (this.show_tasks_mainloop_id) {
            Mainloop.source_remove(this.show_tasks_mainloop_id);
            this.show_tasks_mainloop_id = null;
        }

        for (let i = 0, len = this.delegate.tasks_viewport.length; i < len; i++)
            this.delegate.tasks_viewport[i].actor.visible = false;
    },
});
Signals.addSignalMethods(ViewManager.prototype);
