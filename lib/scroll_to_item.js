// @scrollbox: the St.ScrollBox
// @inner_box: the St.ScrollView
// @item:      a child of @inner_box
function scroll (scrollbox, inner_box, item) {
    //
    // compute the vertical padding of the scrollbox
    //
    let padding = 0;

    let outer_theme_node = scrollbox.get_theme_node();
    let outer_width = scrollbox.get_allocation_box().x2 - scrollbox.get_allocation_box().x1;
    outer_width = outer_theme_node.adjust_for_width(outer_width);

    let [min_outer_height, nat_outer_height] = scrollbox.get_preferred_height(outer_width);
    let [, nat_outer_height_adjusted] = outer_theme_node.adjust_preferred_height(min_outer_height, nat_outer_height);

    padding += nat_outer_height_adjusted - nat_outer_height;


    //
    // compute the vertical padding of the inner_box
    //
    let inner_theme_node = inner_box.get_theme_node();
    let inner_width = inner_box.get_allocation_box().x2 - inner_box.get_allocation_box().x1;
    inner_width = inner_theme_node.adjust_for_width(inner_width);

    let [min_inner_height, nat_inner_height] = inner_box.get_preferred_height(inner_width);
    let [, nat_inner_height_adjusted] = inner_theme_node.adjust_preferred_height(min_inner_height, nat_inner_height);

    padding += Math.round((nat_inner_height_adjusted - nat_inner_height) / 2);


    //
    // scroll
    //
    let current_scroll_value = scrollbox.get_vscroll_bar()
                               .get_adjustment().get_value();

    let new_scroll_value = current_scroll_value;

    let box_height = scrollbox.get_allocation_box().y2 -
                     scrollbox.get_allocation_box().y1;

    let item_y1 = item.get_allocation_box().y1;

    if (current_scroll_value > item_y1 - padding)
        new_scroll_value = item_y1 - padding;

    let item_y2 = item.get_allocation_box().y2;

    if (box_height + current_scroll_value < item_y2 + padding)
        new_scroll_value = item_y2 - box_height + padding;

    if (new_scroll_value !== current_scroll_value)
        scrollbox.get_vscroll_bar().get_adjustment().set_value(new_scroll_value);
};
