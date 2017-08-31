// =====================================================================
// @scrollview : the St.ScrollView
// @scrollbox  : an St.ScrollBox (direct child of @scrollview)
// @item       : direct child of @scrollbox
// =====================================================================
function scroll (scrollview, scrollbox, item) {
    let padding = 0;

    //
    // Compute the vertical padding of the scrollbox.
    //
    {
        let outer_theme_node = scrollview.get_theme_node();
        let alloc            = scrollview.get_allocation_box();
        let outer_w = outer_theme_node.adjust_for_width(alloc.x2 - alloc.x1);

        let [min_outer_h, nat_outer_h] =
            scrollview.get_preferred_height(outer_w);

        let [, nat_outer_h_adjusted] =
            outer_theme_node.adjust_preferred_height(min_outer_h, nat_outer_h);

        padding += nat_outer_h_adjusted - nat_outer_h;
    }

    //
    // Update padding taking the inner_box into account.
    //
    {
        let inner_theme_node = scrollbox.get_theme_node();
        let alloc            = scrollbox.get_allocation_box();
        let inner_w = inner_theme_node.adjust_for_width(alloc.x2 - alloc.x1);

        let [min_inner_h, nat_inner_h] =
            scrollbox.get_preferred_height(inner_w);

        let [, nat_inner_h_adjusted] =
            inner_theme_node.adjust_preferred_height(min_inner_h, nat_inner_h);

        padding += Math.round((nat_inner_h_adjusted - nat_inner_h) / 2);
    }

    //
    // Do the scroll.
    //
    {
        let current_scroll_value =
            scrollview.get_vscroll_bar().get_adjustment().get_value();

        let new_scroll_value = current_scroll_value;
        let alloc            = scrollview.get_allocation_box();
        let box_h            = alloc.y2 - alloc.y1;
        let item_y1          = item.get_allocation_box().y1;

        if (current_scroll_value > item_y1 - padding) {
            new_scroll_value = item_y1 - padding;
        }

        let item_y2 = item.get_allocation_box().y2;

        if (box_h + current_scroll_value < item_y2 + padding) {
            new_scroll_value = item_y2 - box_h + padding;
        }

        if (new_scroll_value !== current_scroll_value) {
            scrollview.get_vscroll_bar().get_adjustment()
                                        .set_value(new_scroll_value);
        }
    }
};
