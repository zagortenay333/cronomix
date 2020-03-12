const St         = imports.gi.St;
const Main       = imports.ui.main;
const Gtk        = imports.gi.Gtk;
const Meta       = imports.gi.Meta;
const Clutter    = imports.gi.Clutter;
const Pango      = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;

const Signals    = imports.signals;
const Mainloop   = imports.mainloop;

const ME = imports.misc.extensionUtils.getCurrentExtension();


const MISC = ME.imports.lib.misc_utils;


// =====================================================================
// @@@ Vertical Bars Graph.
//
// To use, first instantiate this class, then call the draw_coord_system()
// and draw_vbars() funcs.
//
// Large numbers of vbars are handled by first reducing the width until
// the min width is reached. After that, we use a scrollview.
// The max width of the texture is 8192px. Exceeding this is handled by simply
// not rendering anymore, so we cannot draw an indefinite n of vbars.
//
// @signals:
//   - 'vbar-clicked' (returns label of clicked vbar)
// =====================================================================
var VBars = class VBars {
    constructor () {
        // @this.vbars: array of @vbar
        //
        // @vbar: obj of form:
        //   {
        //      info      : any (could by anything, useful for tooltips)
        //      intervals : array
        //      rgba      : array (e.g, [0.2, 0.8, 1, 0.7])
        //      x_label   : string
        //   }
        //
        // @vbar.intervals: array (of @interval)
        //     @interval: array [int (start), int (end)]
        //     Vbars will be drawn in pieces along the y axis as indicated by
        //     the intervals array.
        this.vbars = [];


        // @this.vbars_pos: array (of @vertices)
        //
        // @vertices: array (of @vertex)
        //
        // @vertex: obj of form:
        //   {
        //      x1 : int
        //      x2 : int
        //      y1 : int
        //      y2 : int
        //   }
        //
        // The @vertices indicate the geometry of the pieces of a particular
        // vbar.
        //
        // The indices of @this.vbars_pos correspond to the indices of
        // @this.vbars.
        //
        // The indices of @vertices correspond to the indices of
        // @vbar.intervals inside @this.vbars.
        this.vbars_pos = [];


        // (@vbar, @interval_idx) -> string
        //
        // @vbar         : obj (a vbar ob)
        // @interval_idx : int (index of interval currently hovered)
        //
        // Used to generate the text for the tooltip which appears when a vbar
        // is hovered over.
        // The returned string can contain pango markup.
        this.tooltip_format_callback = (vbar, interval_idx) => '';


        this.vbars_min_width = 8;
        this.vbars_max_width = 64;


        // This obj should be only edited via the draw_coord_system() func.
        this.coord_info = {
            axes_width          : 2,
            axes_rgba           : [1, 1, 1, 1],
            x_offset            : 30,
            y_offset            : 12,
            n_rulers            : 5,
            y_max               : 10,
            y_conversion_factor : 1,
            y_label_format_func : (y_val) => '' + y_val,
            y_label_left_align  : true,
            rotate_x_labels     : false,
            y_label_size        : 12, // in px
            x_label_size        : 12, // in px
            vbars_bg_rgba       : [1, 1, 1, 1],
            y_label_rgba        : [1, 1, 1, 1],
            x_label_rgba        : [1, 1, 1, 1],
            rulers_rgba         : [1, 1, 1, 0.15],
        };


        // null or array: [vbar, interval_idx]
        this.selected_vbar = null;


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, y_expand: true, style_class: 'vbars-graph' });

        this.layout = new St.Widget({ x_expand: true, y_expand: true, layout_manager: new Clutter.BinLayout(), });
        this.actor.add_actor(this.layout);


        //
        // coordinate system
        //
        this.coord_system_drawing_area = new St.DrawingArea({ x_expand: true, y_expand: true, });
        this.layout.add_child(this.coord_system_drawing_area);


        //
        // graph area
        //
        this.graph_scroll_view = new St.ScrollView({ vscrollbar_policy: Gtk.PolicyType.NEVER, y_expand: true, });
        this.layout.add_child(this.graph_scroll_view);

        this.graph_content = new St.BoxLayout();
        this.graph_scroll_view.add_actor(this.graph_content);

        this.vbars_drawing_area = new St.DrawingArea({ reactive: true, x_expand: true, y_expand: true });
        this.graph_content.add_child(this.vbars_drawing_area);


        //
        // vbar tooltip
        //
        this.vbar_tooltip = new St.Label({ visible: false, style_class: 'graph-tooltip', });
        this.layout.add_child(this.vbar_tooltip);

        this.vbar_tooltip.clutter_text.line_wrap        = true;
        this.vbar_tooltip.clutter_text.single_line_mode = false;
        this.vbar_tooltip.clutter_text.line_wrap_mode   = Pango.WrapMode.WORD_CHAR;


        //
        // listen
        //
        this.graph_scroll_view.connect('scroll-event', (_, event) => {
            this._on_graph_scrolled(event.get_scroll_direction());
        });
        this.coord_system_drawing_area.connect('repaint', (area) => {
            this._draw_coord_system(area);
        });
        this.vbars_drawing_area.connect('repaint', (area) => {
            this._draw_vbars(area);
        });
        this.actor.connect('hide', (_, event) => {
            this.selected_vbar = null;
            this.vbar_tooltip.hide();
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.vbars_drawing_area.connect('leave-event', () => {
            this.selected_vbar = null;
            this.vbar_tooltip.hide();
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.vbars_drawing_area.connect('motion-event', (_, event) => {
            this._find_selected_bar(event);
        });
        this.vbars_drawing_area.connect('button-press-event', () => {
            if (this.selected_vbar) this.emit('vbar-clicked', ...this.selected_vbar);
        });
    }

    // @params: obj
    //   - An object containing properties that are going to replace
    //     the ones from the this.coord_info obj.
    //     Properties that have been omitted will use default values.
    draw_coord_system (params) {
        for (let prop in params) {
            if (!params.hasOwnProperty(prop) || !this.coord_info.hasOwnProperty(prop))
                continue;

            this.coord_info[prop] = params[prop];
        }

        this.coord_system_drawing_area.queue_repaint();
    }

    // @vbars : array (for description, see comment of this.vbars array.)
    // @min_w : int   (min width of vbars.)
    // @min_w : int   (max width of vbars.)
    // @tooltip_format_callback: func (optional)
    //   (for description, see comment of this.tooltip_format_callback() func.)
    draw_vbars (vbars, min_w, max_w, tooltip_format_callback) {
        this.vbars = vbars;

        this.vbars_min_width = min_w;
        this.vbars_max_width = max_w;

        if (tooltip_format_callback)
            this.tooltip_format_callback = tooltip_format_callback;

        this.vbars_drawing_area.queue_repaint();
    }

    // This func should never be called directly, only as a signal handler
    // of the 'repaint' signal.
    _draw_coord_system (area) {
        let cr   = area.get_context();
        let coor = this.coord_info;

        let [w, h]        = area.get_surface_size();
        let x_axis_length = w - coor.x_offset - coor.axes_width;
        let y_axis_length = h - coor.y_offset - coor.axes_width;
        let y_max         = Math.round(10 * (coor.y_max / coor.y_conversion_factor)) / 10;


        //
        // update the graph scrollview
        //
        this.graph_scroll_view.x     = coor.x_offset + coor.axes_width;
        this.graph_scroll_view.width = x_axis_length;


        //
        // draw axes
        //
        let half_axes = coor.axes_width / 2;

        cr.moveTo(coor.x_offset + half_axes, 0);
        cr.lineTo(coor.x_offset + half_axes, y_axis_length + half_axes);
        cr.relLineTo(x_axis_length + coor.x_offset + half_axes, 0);

        cr.setSourceRGBA(...coor.axes_rgba);
        cr.setLineWidth(coor.axes_width);
        cr.stroke();


        //
        // draw y-axis labels and horizontal dashed rulers
        //
        cr.setDash([4, 2], 4);

        let y_spacing         = (y_axis_length - half_axes) / coor.n_rulers;
        let y_label_font_desc = Pango.font_description_from_string(`bold ${coor.y_label_size}px`);
        let ruler_unit        = y_max / coor.n_rulers;

        for (let i = 0; i < coor.n_rulers; i++) {
            let y = Math.round(y_spacing * i) + half_axes;

            // labels
            cr.moveTo(coor.x_offset - 8, y);

            let n = Math.round(10 * ruler_unit * (coor.n_rulers - i)) / 10;
            let pango_layout =
                area.create_pango_layout(coor.y_label_format_func(n));

            pango_layout.set_alignment(Pango.Alignment.RIGHT);
            pango_layout.set_font_description(y_label_font_desc);
            pango_layout.set_width(coor.x_offset);
            PangoCairo.layout_path(cr, pango_layout);

            cr.setSourceRGBA(...coor.y_label_rgba);
            cr.fill();

            // horizontal rulers
            cr.moveTo(coor.x_offset, y);
            cr.lineTo(x_axis_length + coor.x_offset, y);
            cr.setSourceRGBA(...coor.rulers_rgba);
            cr.stroke();
        }

        cr.$dispose();
    }

    // This func should never be called directly, only as a signal handler
    // of the 'repaint' signal.
    _draw_vbars (area) {
        this.graph_scroll_view.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.vbars_pos = [];
        if (this.vbars.length === 0) return;

        let n_gaps_and_bars   = this.vbars.length * 2 + 1;
        let x_label_font_desc = Pango.font_description_from_string(`bold ${this.coord_info.x_label_size}px`);

        let [w, h]        = area.get_surface_size();
        let x_axis_length = w - this.coord_info.x_offset;
        let y_axis_length = h - this.coord_info.y_offset - this.coord_info.axes_width;


        //
        // Find width of gaps/bars needed to fit all bars into the drawing area.
        //
        let bar_w = Math.floor(x_axis_length / n_gaps_and_bars);

        if (bar_w < this.vbars_min_width) {
            bar_w = this.vbars_min_width;
            this.graph_scroll_view.hscrollbar_policy = Gtk.PolicyType.ALWAYS;
        } else if (bar_w > this.vbars_max_width) {
            bar_w = this.vbars_max_width;
        }


        //
        // Draw the bars
        //
        let cr = area.get_context();
        let y_axes_scale_factor = y_axis_length / this.coord_info.y_max;

        // We want the bars centered relative to the x-axis, so find the x coord
        // of the first bar.
        let x_offset = Math.round((x_axis_length - (bar_w * n_gaps_and_bars)) / 2);

        if (x_offset < 0) x_offset = 0;

        x_offset += bar_w; // add 1 bar worth of padding at the beginning

        let texture_w = x_offset;

        for (let i = 0; i < this.vbars.length; i++) {
            if (this.vbars[i].intervals.length === 0) continue;
            let x = i * bar_w * 2 + x_offset;
            cr.rectangle(x, 0, bar_w, y_axis_length);
        }

        cr.setSourceRGBA(...this.coord_info.vbars_bg_rgba);
        cr.fill();

        for (let i = 0; i < this.vbars.length; i++) {
            let vbar = this.vbars[i];

            let x = i * bar_w * 2 + x_offset;

            let pos_array = [];
            this.vbars_pos.push(pos_array);

            for (let interval of vbar.intervals) {
                let y1 = y_axis_length - Math.floor(interval[1] * y_axes_scale_factor);
                let y2 = y_axis_length - Math.floor(interval[0] * y_axes_scale_factor);

                // The - 1 is to add a 1px min spacing between bars.
                cr.rectangle(x, y1, bar_w, y2 - y1 - 1);

                pos_array.push({
                    x1: x,
                    x2: x + bar_w,
                    y1: y1,
                    y2: y2,
                });
            }

            cr.setSourceRGBA(...vbar.rgba);
            cr.fill();

            if (vbar.x_label) {
                let pango_layout = this.coord_system_drawing_area
                                   .create_pango_layout(vbar.x_label);

                if (this.coord_info.rotate_x_labels) {
                    cr.moveTo(x + Math.round(bar_w / 2), y_axis_length + 8);
                    pango_layout.set_alignment(Pango.Alignment.LEFT);
                    cr.rotate(Math.PI / 4);
                } else {
                    cr.moveTo(x + Math.round(bar_w / 2), y_axis_length + 8);
                    pango_layout.set_width(bar_w * 2);
                    pango_layout.set_alignment(Pango.Alignment.CENTER);
                }

                pango_layout.set_font_description(x_label_font_desc);
                PangoCairo.layout_path(cr, pango_layout);
                cr.setSourceRGBA(...this.coord_info.x_label_rgba);
                cr.fill();

                if (this.coord_info.rotate_x_labels) cr.rotate(-(Math.PI / 4));
            }

            texture_w += bar_w * 2;

            if (texture_w > 8192) {
                texture_w -= bar_w * 2;
                break;
            }
        }

        area.set_width(texture_w);

        cr.$dispose();
    }

    _on_graph_scrolled (direction) {
        let delta = 0;

        switch (direction) {
          case Clutter.ScrollDirection.UP:
            delta = -1;
            break;
          case Clutter.ScrollDirection.DOWN:
            delta = 1;
            break;
          default:
            return Clutter.EVENT_PROPAGATE;
        }

        this.graph_scroll_view.hscroll.adjustment.value +=
            delta * this.graph_scroll_view.hscroll.adjustment.stepIncrement;

        return Clutter.EVENT_STOP;
    }

    _find_selected_bar (event) {
        // get screen coord of mouse
        let [x, y] = event.get_coords();

        // make coords relative to the graph actor
        [, x, y] = this.vbars_drawing_area.transform_stage_point(x, y);

        x = Math.floor(x);
        y = Math.floor(y);

        let found = null;

        outer: for (let i = 0; i < this.vbars_pos.length; i++) {
            let intervals = this.vbars_pos[i];

            for (let j = 0; j < intervals.length; j++) {
                let it = intervals[j];

                if ((x > it.x1 && x < it.x2) && (y >= it.y1 && y <= it.y2)) {
                    found = [this.vbars[i], j];
                    break outer;
                }
            }
        }

        // update tooltip
        if (!found) {
            this.vbar_tooltip.hide();
            this.vbar_tooltip.set_position(0, 0);
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
            this.selected_vbar = null;
        } else if (!this.selected_vbar || found[1] !== this.selected_vbar[1]) {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.POINTING_HAND);

            // We don't want the tooltip to overlap the mouse cursor.
            // Doesn't take into account the cursor size...
            x += 20;
            y += 20;

            if (typeof this.tooltip_format_callback === 'function')
                this.vbar_tooltip.clutter_text.set_markup(this.tooltip_format_callback(...found));

            this.vbar_tooltip.x = 0;
            this.vbar_tooltip.show();

            let a = this.vbar_tooltip.get_allocation_box();
            let tooltip_w = a.x2 - a.x1;
            let tooltip_h = a.y2 - a.y1;

            let h_scroll = Math.round(this.graph_scroll_view.get_hscroll_bar().get_adjustment().get_value());

            let tooltip_x = x + this.coord_info.x_offset;
            let tooltip_y = y;

            a = this.graph_scroll_view.get_allocation_box();
            let delta_x = a.x2 - a.x1 - tooltip_x + h_scroll;
            let delta_y = a.y2 - a.y1 - tooltip_y;

            if (tooltip_w > delta_x) tooltip_x -= tooltip_w - delta_x;
            if (tooltip_h > delta_y) tooltip_y -= tooltip_h - delta_y;

            this.vbar_tooltip.set_position(tooltip_x - h_scroll, tooltip_y);
            this.vbar_tooltip.raise_top();
        }

        this.selected_vbar = found;
    }
}
Signals.addSignalMethods(VBars.prototype);



// =====================================================================
// @@@ Heatmap Graph
//
// To use, first instantiate this class, then call the draw_heatmap()
// func.
//
// @signals:
//   - 'square-clicked' (returns label of clicked square);
// =====================================================================
var HeatMap = class HeatMap {
    constructor () {
        // @matrix: array of arrays (2d matrix of 0 or objects of form:
        //     {
        //         label : string,
        //         rgba  : array, (e.g, [0.2, 0.8, 1, 0.7])
        //     }
        //     0 means empty slot in the heatmap
        //
        // @matrix_size: array [largest_row, largest_column]
        //
        // @row_labels: array of arrays [[row_num, label], [row_num, label]...]
        //
        // @col_labels: array of arrays [[col_num, label], [col_num, label]...]
        //
        // @tooltip_format_callback: func (square.label) -> string
        //                           (used to format the tooltip label)
        this.params = {
            matrix               : [],
            matrix_size          : [],
            row_labels           : [],
            col_labels           : [],
            row_label_size       : 12, // in px
            col_label_size       : 12, // in px
            x_offset             : 35, // in px
            y_offset             : 20, // in px
            square_size          : 14, // in px
            square_spacing       : 2,  // in px
            row_label_rgba       : [1, 1, 1, 1],
            col_label_rgba       : [1, 1, 1, 1],
            selected_square_rgba : [1, 1, 1, 1],
            tooltip_callback     : (label) => label,
        };


        // array [x, y] which is the pos of hovered_square in this.params.matrix
        this.hovered_square_pos = null;

        // null or element of this.params.matrix
        this.hovered_square = null;

        // same as this.hovered_square
        this.selected_square = null;


        //
        // container
        //
        this.actor = new St.BoxLayout({ x_expand: true, style_class: 'heatmap-graph' });

        this.layout = new St.Widget({ x_expand: true, layout_manager: new Clutter.BinLayout(), });
        this.actor.add_actor(this.layout);


        //
        // graph area
        //
        this.graph_scroll_view = new St.ScrollView({ x_expand: true, });
        this.layout.add_child(this.graph_scroll_view);

        this.graph_content = new St.BoxLayout();
        this.graph_scroll_view.add_actor(this.graph_content);

        this.heatmap_drawing_area = new St.DrawingArea({ reactive: true, x_expand: true, });
        this.graph_content.add_child(this.heatmap_drawing_area);


        //
        // heatmap tooltip
        //
        this.heatmap_tooltip = new St.Label({ visible: false, style_class: 'graph-tooltip', });
        this.layout.add_child(this.heatmap_tooltip);

        this.heatmap_tooltip.clutter_text.line_wrap      = true;
        this.heatmap_tooltip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;



        //
        // listen
        //
        this.graph_scroll_view.connect('scroll-event', (_, event) => {
            this._on_graph_scrolled(event.get_scroll_direction());
        });
        this.heatmap_drawing_area.connect('repaint', (area) => {
            this._draw_heatmap(area);
        });
        this.actor.connect('hide', (_, event) => {
            this.selected_heatmap = null;
            this.heatmap_tooltip.hide();
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.heatmap_drawing_area.connect('leave-event', () => {
            this.hovered_square = null;
            this.heatmap_tooltip.hide();
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.heatmap_drawing_area.connect('motion-event', (_, event) => {
            this._find_selected_square(event);
        });
        this.heatmap_drawing_area.connect('button-press-event', () => {
            if (this.hovered_square) this._on_square_clicked();
        });
    }

    // @params: obj (props with which to update the this.params obj)
    update_params (params) {
        if (params) {
            for (let p in params) {
                if (params.hasOwnProperty(p) && this.params.hasOwnProperty(p))
                    this.params[p] = params[p];
            }
        }
    }

    // @params: obj (props with which to update the this.params obj)
    draw_heatmap (params) {
        this.update_params(params);

        let s = this.params.square_size + this.params.square_spacing;

        this.heatmap_drawing_area.set_size(
            s * this.params.matrix_size[1] - this.params.square_spacing + this.params.x_offset,
            s * this.params.matrix_size[0] - this.params.square_spacing + this.params.y_offset
        );

        this.heatmap_drawing_area.queue_repaint();
    }

    // This func should never be called directly, only as a signal handler
    // of the 'repaint' signal.
    _draw_heatmap (area) {
        let cr = area.get_context();

        let square_size        = this.params.square_size;
        let square_and_spacing = square_size + this.params.square_spacing;

        cr.setSourceRGBA(...this.params.row_label_rgba);

        for (let row_label of this.params.row_labels) {
            let label = Pango.font_description_from_string(
                `bold ${this.params.row_label_size}px`);

            let pango_layout = this.heatmap_drawing_area.create_pango_layout(row_label[1]);

            cr.moveTo(this.params.x_offset - 8, square_and_spacing * row_label[0] + this.params.y_offset);
            pango_layout.set_alignment(Pango.Alignment.RIGHT);
            pango_layout.set_font_description(label);
            pango_layout.set_width(this.params.x_offset);
            PangoCairo.layout_path(cr, pango_layout);
        }

        cr.fill();

        cr.setSourceRGBA(...this.params.col_label_rgba);

        for (let col_label of this.params.col_labels) {
            let label = Pango.font_description_from_string(`bold ${this.params.col_label_size}px`);
            let pango_layout = this.heatmap_drawing_area.create_pango_layout(col_label[1]);

            cr.moveTo(square_and_spacing * col_label[0] + this.params.x_offset,
                      this.params.y_offset - this.params.square_size - 8);

            pango_layout.set_font_description(label);
            PangoCairo.layout_path(cr, pango_layout);
        }

        cr.fill();

        let x = this.params.x_offset;
        let y = this.params.y_offset;

        for (let row of this.params.matrix) {
            for (let square of row) {
                if (square) {
                    cr.rectangle(x, y, square_size, square_size);
                    cr.setSourceRGBA(...square.rgba);
                    cr.fill();
                }

                x += square_and_spacing;
            }

            x = this.params.x_offset;
            y += square_and_spacing;
        }

        if (this.selected_square) {
            x = this.params.x_offset + this.selected_square_pos[0] * square_and_spacing;
            y = this.params.y_offset + this.selected_square_pos[1] * square_and_spacing;

            cr.rectangle(x, y, 2, square_size);
            cr.rectangle(x, y, square_size, 2);
            cr.rectangle(x + square_size - 2, y, 2, square_size);
            cr.rectangle(x, y + square_size - 2, square_size, 2);

            cr.setSourceRGBA(...this.params.selected_square_rgba);
            cr.fill();
        }

        cr.$dispose();
    }

    _on_graph_scrolled (direction) {
        let delta = 0;

        switch (direction) {
          case Clutter.ScrollDirection.UP:
            delta = -1;
            break;
          case Clutter.ScrollDirection.DOWN:
            delta = 1;
            break;
          default:
            return Clutter.EVENT_PROPAGATE;
        }

        this.graph_scroll_view.hscroll.adjustment.value +=
            delta * this.graph_scroll_view.hscroll.adjustment.stepIncrement;

        return Clutter.EVENT_STOP;
    }

    _on_square_clicked () {
        this.selected_square     = this.hovered_square;
        this.selected_square_pos = this.hovered_square_pos;
        this.draw_heatmap();

        this.emit('square-clicked', this.hovered_square.label);
    }

    _find_selected_square (event) {
        // get screen coord of mouse
        let [x, y] = event.get_coords();

        // make coords relative to the graph actor
        [, x, y] = this.heatmap_drawing_area.transform_stage_point(x, y);

        let m_x = x - this.params.x_offset;
        let m_y = y - this.params.y_offset;

        m_x = Math.floor(
            m_x / (this.params.square_size + this.params.square_spacing));

        m_y = Math.floor(
            m_y / (this.params.square_size + this.params.square_spacing));

        let found = Boolean(
            m_x > -1 &&
            m_y > -1 &&
            m_y < this.params.matrix_size[0] &&
            m_x < this.params.matrix[m_y].length &&
            this.params.matrix[m_y][m_x]
        );

        // update tooltip
        if (!found) {
            this.heatmap_tooltip.hide();
            this.hovered_square = null;
            this.heatmap_tooltip.set_position(0, 0);
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.DEFAULT);
        } else if (this.params.matrix[m_y][m_x] !== this.hovered_square) {
            MISC.global_wrapper.display.set_cursor(Meta.Cursor.POINTING_HAND);

            // We don't want the tooltip to overlap the mouse cursor.
            // Doesn't take into account the cursor size...
            x += 15;
            y += 15;

            this.hovered_square_pos   = [m_x, m_y]
            this.hovered_square       = this.params.matrix[m_y][m_x];
            this.heatmap_tooltip.text = this.params.tooltip_callback(this.hovered_square.label)

            this.heatmap_tooltip.x = 0;
            this.heatmap_tooltip.show();

            let a = this.heatmap_tooltip.get_allocation_box();
            let tooltip_w = a.x2 - a.x1;
            let tooltip_h = a.y2 - a.y1;

            let h_scroll = Math.round(this.graph_scroll_view.get_hscroll_bar().get_adjustment().get_value());

            let tooltip_x = x + this.params.x_offset;
            let tooltip_y = y;

            a = this.graph_scroll_view.get_allocation_box();
            let delta_x = a.x2 - a.x1 - tooltip_x + h_scroll;
            let delta_y = a.y2 - a.y1 - tooltip_y;

            if (tooltip_w > delta_x) tooltip_x -= tooltip_w - delta_x;
            if (tooltip_h > delta_y) tooltip_y -= tooltip_h - delta_y;

            this.heatmap_tooltip.set_position(tooltip_x - h_scroll, tooltip_y);
            this.heatmap_tooltip.raise_top();
        }
    }
}
Signals.addSignalMethods(HeatMap.prototype);
