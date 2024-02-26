import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Button } from './button.js';
import { Rectangle } from './misc.js';
import { FocusTracker } from './focus.js';

export class ScrollBox {
    actor: St.ScrollView;
    box: St.BoxLayout;

    constructor (vertical = true) {
        this.actor = new St.ScrollView({ x_expand: true, overlay_scrollbars: true, style_class: 'cronomix-scrollbox' });

        this.box = new St.BoxLayout({ vertical, x_expand: true, style_class: 'cronomix-spacing' });
        this.actor.add_actor(this.box);

        if (vertical) {
            this.actor.add_style_class_name('vertical');
            this.actor.hscrollbar_policy = St.PolicyType.NEVER;
        } else {
            this.actor.add_style_class_name('horizontal');
            this.actor.vscrollbar_policy = St.PolicyType.NEVER;

            // Scroll horizontally if the user holds the control key while scrolling.
            this.actor.connect('captured-event', (_:unknown, event: Clutter.Event) => {
                if (! event.has_control_modifier()) return Clutter.EVENT_PROPAGATE;
                if (event.type() !== Clutter.EventType.SCROLL) return Clutter.EVENT_PROPAGATE;

                const direction  = event.get_scroll_direction();
                const adjustment = this.actor.get_hscroll_bar()!.get_adjustment();

                if (direction === Clutter.ScrollDirection.UP) {
                    adjustment.value -= adjustment.stepIncrement;
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    adjustment.value += adjustment.stepIncrement;
                }

                return Clutter.EVENT_STOP;
            });
        }

        //
        // Make the scrollbar autohide
        //
        const bar = vertical ? 'vscroll' : 'hscroll';
        this.actor[bar].opacity = 0;
        const set_bar_opacity = (opacity: number) => { if (this.actor[bar]) this.actor[bar].opacity = opacity; }

        const tracker = new FocusTracker(this.actor);
        tracker.subscribe('focus_enter', () => set_bar_opacity(130));
        tracker.subscribe('focus_leave', (has_pointer) => set_bar_opacity(has_pointer ? 130 : 0));
        tracker.subscribe('pointer_enter', () => set_bar_opacity(130));
        tracker.subscribe('pointer_leave', (has_focus) => set_bar_opacity(has_focus ? 130 : 0));
    }
}

export class LazyScrollBox extends ScrollBox {
    #n_children = -1;
    #fetch_size: number;
    #show_more_button: Button;
    #children: IterableIterator<St.Widget> | null = null;

    constructor (fetch_size: number, vertical = true) {
        super(vertical);
        this.#fetch_size = fetch_size;
        this.#show_more_button = new Button({ label: _('Show more') });
        this.#show_more_button.subscribe('left_click', () => this.#show_more());
        this.#show_more_button.actor.connect('key-focus-in', () => scroll_to_widget(this.#show_more_button.actor));
    }

    // Set n_children to -1 if you don't know how many there are.
    set_children (n_children: number, children: IterableIterator<St.Widget>) {
        if (this.actor.vscrollbar_visible) {
            const adjust = this.actor.get_vscroll_bar()!.get_adjustment();
            adjust.set_value(0);
        }

        const p = this.#show_more_button.actor.get_parent();
        if (p) p.remove_child(this.#show_more_button.actor);
        this.box.destroy_all_children();
        this.box.add_actor(this.#show_more_button.actor);
        this.#children = children;
        this.#n_children = n_children;
        this.#show_more(false);
    }

    #show_more (refocus = true) {
        if (! this.#children) return;

        this.actor.show();
        this.box.remove_child(this.#show_more_button.actor);

        const prev_child = this.box.get_last_child();
        let first_child: St.Widget | null = null;

        let n = this.#fetch_size;
        while (n) {
            const result = this.#children.next();
            if (! first_child) first_child = result.value;
            if (result.done) break;
            this.box.add_actor(result.value);
            n--;
        }

        if (refocus) {
            if (first_child) {
                first_child.grab_key_focus();
                scroll_to_widget(first_child);
            } else if (prev_child) {
                prev_child.grab_key_focus();
                scroll_to_widget(prev_child);
            }
        }

        if (n > 0) {
            this.#children = null;
        } else if (this.#n_children === -1 || this.box.get_n_children() < this.#n_children) {
            this.box.add_actor(this.#show_more_button.actor);
        }
    }
}

// Scrolls every ScrollView that contains @actor both vertically
// and horizontally until the actor is visible.
//
// The @box parameter is assumed to be contained within the
// @actor's allocation box. If this parameter is given, then
// we scroll to the edges of this sub-box. This parameter can
// be used to, for example, scroll to a particular line within
// a Clutter.Text, assuming @box is the bounding box of the line.
//
// 1. If @scroll_to_top is true we scroll to top/left edge.
// 2. If @actor is below view, we scroll to bottom/right edge.
// 3. If @actor is above view, we scroll to top/left edge.
// 4. If @actor is in view, we don't scroll.
export function scroll_to_widget (widget: Clutter.Actor, box?: Rectangle, scroll_to_top = false) {
    if (! widget.is_mapped()) return;

    let ancestor   = widget.get_parent();
    let descendant = widget;
    const stack    = new Array<[St.ScrollView, Clutter.Actor]>();

    while (ancestor) {
        if (ancestor instanceof St.ScrollView) {
            stack.push([ancestor, descendant]);
            descendant = ancestor;
        }

        ancestor = ancestor.get_parent();
    }

    for (const [scrollview, descendant] of stack) {
        const scrollbox = scrollview.get_child()!;

        let hpadding = 0;
        let vpadding = 0;

        { // Compute the padding of the scrollview:
            const n = scrollview.get_theme_node();
            const a = scrollview.get_allocation_box();

            if (scrollview.hscrollbar_policy !== St.PolicyType.NEVER) {
                const h                  = n.adjust_for_height(a.y2 - a.y1);
                const [min_w, nat_w]     = scrollview.get_preferred_width(h);
                const [, nat_w_adjusted] = n.adjust_preferred_width(min_w, nat_w);
                hpadding                += nat_w_adjusted - nat_w;

                const bar_box = scrollview.hscroll.get_allocation_box();
                hpadding += bar_box.y2 - bar_box.y1;
            }

            if (scrollview.vscrollbar_policy !== St.PolicyType.NEVER) {
                const w                  = n.adjust_for_width(a.x2 - a.x1);
                const [min_h, nat_h]     = scrollview.get_preferred_height(w);
                const [, nat_h_adjusted] = n.adjust_preferred_height(min_h, nat_h);
                vpadding                += nat_h_adjusted - nat_h;

                const bar_box = scrollview.vscroll.get_allocation_box();
                vpadding += bar_box.x2 - bar_box.x1;
            }
        }

        // Update padding taking the scrollbox into account:
        if (scrollbox instanceof St.Widget) {
            const n = scrollbox.get_theme_node();
            const a = scrollbox.get_allocation_box();

            if (scrollview.hscrollbar_policy !== St.PolicyType.NEVER) {
                const h                  = n.adjust_for_height(a.y2 - a.y1);
                const [min_w, nat_w]     = scrollbox.get_preferred_width(h);
                const [, nat_w_adjusted] = n.adjust_preferred_width(min_w, nat_w);
                hpadding                += nat_w_adjusted - nat_w;
            }

            if (scrollview.vscrollbar_policy !== St.PolicyType.NEVER) {
                const w                  = n.adjust_for_width(a.x2 - a.x1);
                const [min_h, nat_h]     = scrollbox.get_preferred_height(w);
                const [, nat_h_adjusted] = n.adjust_preferred_height(min_h, nat_h);
                vpadding                += nat_h_adjusted - nat_h;
            }
        }

        { // Do the scroll:
            const a = (descendant === widget && box) ? box : descendant.get_allocation_box();
            let p1  = new Graphene.Point3D({ x: a.x1, y: a.y1 });
            let p2  = new Graphene.Point3D({ x: a.x2, y: a.y2 });
            p1      = descendant.get_parent()!.apply_relative_transform_to_point(scrollbox, p1);
            p2      = descendant.get_parent()!.apply_relative_transform_to_point(scrollbox, p2);

            if (scrollview.hscrollbar_visible) {
                const bar    = scrollview.get_hscroll_bar()!;
                const adjust = bar.get_adjustment();
                const sa     = scrollview.get_allocation_box();
                const pos    = adjust.get_value();
                const low    = p1.x - hpadding;
                const high   = p2.x + hpadding - (sa.x2 - sa.x1);

                if      (scroll_to_top) adjust.set_value(low);
                else if (pos > low)     adjust.set_value(low);
                else if (pos < high)    adjust.set_value(high);
            }

            if (scrollview.vscrollbar_visible) {
                const bar    = scrollview.get_vscroll_bar()!;
                const adjust = bar.get_adjustment();
                const sa     = scrollview.get_allocation_box();
                const pos    = adjust.get_value();
                const low    = p1.y - vpadding;
                const high   = p2.y + vpadding - (sa.y2 - sa.y1);

                if      (scroll_to_top) adjust.set_value(low);
                else if (pos > low)     adjust.set_value(low);
                else if (pos < high)    adjust.set_value(high);
            }
        }
    }
}
