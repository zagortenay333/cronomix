// =====================================================================
// @BUG
// There is an issue with resizing when using pango's wrap mode together with a
// scrollview. The label does not seem to get resized properly and as a result
// to container doesn't either, which leads various issues.
//
// The needs_scrollbar func will not return a correct value because of this.
// Also, sometimes the bottom actor might be cut off, or extra padding might be
// added...
//
// The issue does not appear if the scrollbar is visible, so it doesn't need to
// be used all the time and is not a performance issue.
//
// This func needs to be used at a time when the actor is already drawn, or it
// will not work.
//
// @label: St.Label
// =====================================================================
function resize_label (label) {
    let theme_node = label.get_theme_node();
    let alloc_box  = label.get_allocation_box();

    // gets the acutal width of the box
    let w = alloc_box.x2 - alloc_box.x1;

    // remove paddings and borders
    w = theme_node.adjust_for_width(w);

    // nat_height is the minimum height needed to fit the multiline text
    // **excluding** the vertical paddings/borders.
    let [min_h, nat_h] = label.clutter_text.get_preferred_height(w);

    // The vertical padding can only be calculated once the box is painted.
    // nat_height_adjusted is the minimum height needed to fit the multiline
    // text **including** vertical padding/borders.
    let [min_h_adjusted, nat_h_adjusted] =
        theme_node.adjust_preferred_height(min_h, nat_h);

    let vert_padding = nat_h_adjusted - nat_h;

    label.set_height(nat_h + vert_padding);
}
