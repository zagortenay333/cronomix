// ==============================================================================
// This file is handwritten. It only contains the
// parts of the gnome API that this extension uses.
// ==============================================================================

declare const global: any;
declare const log: (msg: any) => void;
declare const logError: (err: unknown) => void;

declare module 'gi://St' {
    import Gio from 'gi://Gio';
    import Clutter from 'gi://Clutter';
    import GObject from 'gi://GObject';

    namespace St {
        enum PolicyType {
            ALWAYS,
            AUTOMATIC,
            NEVER,
            EXTERNAL,
        }

        enum Side {
            TOP,
            RIGHT,
            BOTTOM,
            LEFT,
        }

        enum ClipboardType {
            PRIMARY,
            CLIPBOARD,
        }

        class Clipboard extends GObject.Object {
            static get_default (): Clipboard;
            set_text (type: ClipboardType, text: string): void;
        }

        class Theme extends GObject.Object {
            load_stylesheet (file: Gio.File): void;
            unload_stylesheet (file: Gio.File): void;
        }

        class ThemeContext extends GObject.Object {
            scale_factor: number;
            get_theme (): Theme;
            set_theme (theme: Theme): void;
            static get_for_stage: (stage: Clutter.Stage) => ThemeContext;
        }

        class ThemeNode extends GObject.Object {
            get_max_height (): number;
            get_vertical_padding (): number;
            get_horizontal_padding (): number;
            lookup_color (property: string, inherit: boolean): [boolean, Clutter.Color];
            adjust_preferred_height (min_width: number, natural_width: number): [number, number];
            adjust_preferred_width (min_height: number, natural_height: number): [number, number];
            adjust_for_width (w: number): number;
            adjust_for_height (h: number): number;
        }

        class Widget extends Clutter.Actor {
            can_focus: boolean;
            style_class: string;
            pseudo_class: string;
            pseudo_style_class: string;
            constructor (...args: unknown[]);
            layout_manager: Clutter.LayoutManager;
            set style (style: string | null);
            set_style (style: string | null): void;
            get_style (): string;
            set_style_class_name (name: string): void;
            add_style_class_name (name: string): void;
            remove_style_class_name (name: string): void;
            add_style_pseudo_class (name: string): void;
            remove_style_pseudo_class (name: string): void;
            get_theme_node (): ThemeNode;
        }

        class BoxLayout extends Widget {
            vertical: boolean;
            constructor (...args: unknown[]);
            layout_manager: Clutter.BoxLayout;
        }

        class Icon extends Widget {
            constructor (...args: unknown[]);
            gicon: Gio.Icon;
        }

        class Bin extends Widget {
            get_child (): Clutter.Actor | null;
        }

        class Label extends Widget {
            text: string;
            clutter_text: Clutter.Text;
            constructor (...args: unknown[]);
            get_text (): string;
            set_text (text: string): void;
        }

        class Entry extends Widget {
            text: string;
            clutter_text: Clutter.Text;
            constructor (...args: unknown[]);
            get_text (): string;
            set_text (text: string): void;
            set_primary_icon (icon: Clutter.Actor): void;
            set_secondary_icon (icon: Clutter.Actor): void;
        }

        class ImageContent extends Clutter.Content {
            static new_with_preferred_size (w:number, h:number): ImageContent;
        }

        class Button extends Bin {
            label: string;
            checked: boolean;
            constructor (...args: unknown[]);
        }

        class Adjustment extends GObject.Object {
            upper: number;
            lower: number;
            value: number;
            page_size: number;
            stepIncrement: number;
            get_value (): number;
            set_value (value: number): void;
        }

        class ScrollBar extends Widget {
            vertical: boolean;
            adjustment: Adjustment;
            get_adjustment (): Adjustment;
            set_adjustment (val: Adjustment): void;
        }

        class ScrollView extends Bin {
            vscrollbar_visible: boolean;
            hscrollbar_visible: boolean;
            vscrollbar_policy: PolicyType;
            hscrollbar_policy: PolicyType;
            constructor (...args: unknown[]);
            get_hscroll_bar (): ScrollBar;
            get_vscroll_bar (): ScrollBar;
            overlay_scrollbars: boolean;
            hscroll: ScrollBar;
            vscroll: ScrollBar;
        }
    }

    export default St;
}

declare module 'gi://Clutter' {
    import St from 'gi://St';
    import Pango from 'gi://Pango';
    import GObject from 'gi://GObject';
    import Graphene from 'gi://Graphene';

    namespace Clutter {
        // We don't list all key constants here since there's thousands of them.
        const KEY_space:     number,
              KEY_Return:    number,
              KEY_KP_Enter:  number,
              KEY_Escape:    number,
              KEY_Tab:       number,
              KEY_slash:     number,
              KEY_BackSpace: number,

              KEY_F1: number,
              KEY_F2: number,
              KEY_F3: number,
              KEY_F4: number,
              KEY_F5: number,
              KEY_F6: number,
              KEY_F7: number,
              KEY_F8: number,
              KEY_F9: number,

              KEY_Up:    number,
              KEY_Down:  number,
              KEY_Left:  number,
              KEY_Right: number,

              KEY_a:number, KEY_b:number, KEY_c:number, KEY_d:number,
              KEY_e:number, KEY_f:number, KEY_g:number, KEY_h:number,
              KEY_i:number, KEY_j:number, KEY_k:number, KEY_l:number,
              KEY_m:number, KEY_n:number, KEY_o:number, KEY_p:number,
              KEY_q:number, KEY_r:number, KEY_s:number, KEY_t:number,
              KEY_u:number, KEY_v:number, KEY_w:number, KEY_x:number,
              KEY_y:number, KEY_z:number,

              KEY_0:number, KEY_1:number, KEY_2:number, KEY_3:number,
              KEY_4:number, KEY_5:number, KEY_6:number, KEY_7:number,
              KEY_8:number, KEY_9:number;

        const BUTTON_MIDDLE: number;
        const BUTTON_PRIMARY: number;
        const BUTTON_SECONDARY: number;

        type BUTTON_MIDDLE = number;
        type BUTTON_PRIMARY = number;
        type BUTTON_SECONDARY = number;

        const EVENT_STOP: boolean;
        const EVENT_PROPAGATE: boolean;

        enum EventType {
            NOTHING,
            KEY_PRESS,
            KEY_RELEASE,
            MOTION,
            ENTER,
            LEAVE,
            BUTTON_PRESS,
            BUTTON_RELEASE,
            SCROLL,
            TOUCH_BEGIN,
            TOUCH_UPDATE,
            TOUCH_END,
            TOUCH_CANCEL,
            TOUCHPAD_PINCH,
            TOUCHPAD_SWIPE,
            TOUCHPAD_HOLD,
            PROXIMITY_IN,
            PROXIMITY_OUT,
            PAD_BUTTON_PRESS,
            PAD_BUTTON_RELEASE,
            PAD_STRIP,
            PAD_RING,
            DEVICE_ADDED,
            DEVICE_REMOVED,
            IM_COMMIT,
            IM_DELETE,
            IM_PREEDIT,
            EVENT_LAST,
        }

        enum ActorAlign {
            FILL,
            START,
            CENTER,
            END,
        }

        enum ScrollDirection {
            UP,
            DOWN,
            LEFT,
            RIGHT,
            SMOOTH,
        }

        enum PickMode {
            ALL,
            REACTIVE,
            NONE,
        }

        enum SnapEdge {
            TOP,
            RIGHT,
            BOTTOM,
            LEFT,
        }

        class Color {
            red:   number;
            green: number;
            blue:  number;
            alpha: number;
            to_string (): string;
        }

        class Event {
            type (): EventType;
            get_button (): number;
            get_coords (): [x: number, y: number];
            get_source (): Actor | null;
            has_control_modifier (): boolean;
            get_related (): Actor | null;
            get_key_symbol (): number;
            get_key_code (): number;
            get_state (): unknown;
            get_scroll_direction (): ScrollDirection;
        }

        class Constraint extends GObject.Object {
        }

        class SnapConstraint extends Constraint {
            constructor (...args: unknown[]);
            set_offset (offset: number): void;
        }

        class LayoutManager extends GObject.Object {
        }

        class BoxLayout extends LayoutManager {
            homogeneous: boolean;
        }

        class GridLayout extends LayoutManager {
            constructor (...args: unknown[]);
            attach (child: Actor, c: number, r: number, w: number, h: number): void;
        }

        class ActorBox {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
        }

        class Actor extends GObject.Object {
            width: number;
            min_width: number;
            natural_width: number;
            height: number;
            opacity: number;
            visible: boolean;
            reactive: boolean;
            x_align: number;
            y_align: number;
            x_expand: boolean;
            y_expand: boolean;

            hide (): void;
            show (): void;
            event (event: Event, phase: boolean): boolean;
            destroy (): void;
            set_content (content: Content): void;
            set_content_gravity (gravity: ContentGravity): void;
            contains (actor: Actor): boolean;
            is_mapped (): boolean;
            get_size (): [number, number];
            set_size (width: number, height: number): void;
            set_height (height: number): void;
            set_width (width: number): void;
            get_height (): number;
            get_parent (): Actor;
            insert_child_at_index (child: Actor, idx: number): void;
            insert_child_above (child: Actor, sibling: Actor | null): void;
            set_child_above_sibling (child: Actor, sibling: Actor | null): void;
            add_actor (child: Actor): void;
            remove_child (child: Actor): void;
            destroy_all_children (): void;
            remove_all_children(): void;
            get_child_at_index (idx: number): Actor | null;
            get_last_child (): Actor | null;
            insert_child_at_index (child: Actor, idx: number): void;
            get_children (): Actor[];
            get_n_children (): number;
            add_constraint (constraint: Constraint): void;
            get_preferred_height (h: number): [number, number];
            get_preferred_width (w: number): [number, number];
            grab_key_focus (): void;
            get_allocation_box (): ActorBox;
            get_transformed_extents (): Graphene.Rect;
            transform_stage_point (x: number, y: number): [ok: boolean, x: number, y: number];
            apply_relative_transform_to_point (ancestor: Actor | null, point: Graphene.Point3D): Graphene.Point3D;
        }

        enum ContentGravity {
            CENTER
        }

        class Content {
            set_bytes (...args: unknown[]): void;
        }

        class Stage extends Actor {
            get_key_focus (): Actor;
        }

        class TextBuffer extends GObject.Object {
            delete_text (start: number, length: number): void;
            insert_text (start: number, text: string, length: number): void;
        }

        class Text extends Actor {
            constructor ();

            text: string;
            buffer: TextBuffer;
            editable: boolean;
            activatable: boolean;
            selectable: boolean;
            single_line_mode: boolean;
            line_wrap: boolean;
            line_wrap_mode: Pango.WrapMode;
            ellipsize: Pango.EllipsizeMode;

            get_cursor_position (): number;
            set_cursor_position (pos: number): void;
            set_markup (markup: string): void;
            get_selection (): string | null;
            delete_selection (): void;
            get_selection_bound (): number;
            set_selection_bound (pos: number): void;
            insert_text (text: string, pos: number): void;
            delete_text (start: number, end: number): void;
            coords_to_position (x: number, y: number): number;
            set_selection (start_pos: number, end_pos: number): void;
            position_to_coords (index: number): [boolean, number, number, number];
        }
    }

    export default Clutter;
}

declare module 'resource:///org/gnome/shell/ui/boxpointer.js' {
    import St from 'gi://St';
    import Clutter from 'gi://Clutter';

    const enum PopupAnimation {
        NONE  = 0,
        SLIDE = 1 << 0,
        FADE  = 1 << 1,
        FULL  = ~0,
    }

    class BoxPointer extends St.Widget {
        constructor (...args: unknown[]);
        bin: St.Bin;
        open (animate?: PopupAnimation, on_done?: () => void): void;
        close (animate?: PopupAnimation, on_done?: () => void): void;
        setPosition (source: Clutter.Actor, side: St.Side): void;
        updateArrowSide(side: St.Side): void;
    }
}

declare module 'resource:///org/gnome/shell/ui/popupMenu.js' {
    import St from 'gi://St';
    import Clutter from 'gi://Clutter';

    class PopupMenuManager {
        constructor (owner: Clutter.Actor, grab_params?: object);
        ignoreRelease (): void;
        addMenu (actor: PopupMenu, position?: number): void;
    }

    class PopupMenu {
        actor: St.Widget;
        constructor (source_actor: Clutter.Actor, arrow_alignment: number, arrow_side: St.Side);
        destroy (): void;
        open (): void;
        close (): void;
    }
}

declare module 'resource:///org/gnome/shell/ui/panelMenu.js' {
    import St from 'gi://St';
    class ButtonBox extends St.Widget { container: St.Bin; }
    class Button extends ButtonBox { menu: any; }
}

declare module 'resource:///org/gnome/shell/ui/windowManager.js' {
    import Shell from 'gi://Shell';
    class WindowManager {
        allowKeybinding (name: string, modes: Shell.ActionMode): void;
    }
}

declare class TextDecoder {
    decode (bytes: unknown, options?: { fatal?: boolean }): string;
}

declare class TextEncoder {
    encode (input?: string): Uint8Array;
}

declare module 'gi://Gio' {
    import GObject from 'gi://GObject';

    namespace Gio {
        enum FileMonitorFlags {
            NONE             = 0,
            WATCH_MOUNTS     = 1 << 0,
            SEND_MOVED       = 1 << 1,
            WATCH_HARD_LINKS = 1 << 2,
            WATCH_MOVES      = 1 << 3,
        }

        enum FileCreateFlags {
            NONE                = 0,
            PRIVATE             = 1 << 0,
            REPLACE_DESTINATION = 1 << 1,
        }

        enum FileMonitorEvent {
            CHANGED,
            CHANGES_DONE_HINT,
            DELETED,
            CREATED,
            ATTRIBUTE_CHANGED,
            PRE_UNMOUNT,
            UNMOUNTED,
            MOVED,
            RENAMED,
            MOVED_IN,
            MOVED_OUT,
        }

        enum IOErrorEnum {
            FAILED,
            NOT_FOUND,
            EXISTS,
            IS_DIRECTORY,
            NOT_DIRECTORY,
            NOT_EMPTY,
            NOT_REGULAR_FILE,
            NOT_SYMBOLIC_LINK,
            NOT_MOUNTABLE_FILE,
            FILENAME_TOO_LONG,
            INVALID_FILENAME,
            TOO_MANY_LINKS,
            NO_SPACE,
            INVALID_ARGUMENT,
            PERMISSION_DENIED,
            NOT_SUPPORTED,
            NOT_MOUNTED,
            ALREADY_MOUNTED,
            CLOSED,
            CANCELLED,
            PENDING,
            READ_ONLY,
            CANT_CREATE_BACKUP,
            WRONG_ETAG,
            TIMED_OUT,
            WOULD_RECURSE,
            BUSY,
            WOULD_BLOCK,
            HOST_NOT_FOUND,
            WOULD_MERGE,
            FAILED_HANDLED,
            TOO_MANY_OPEN_FILES,
            NOT_INITIALIZED,
            ADDRESS_IN_USE,
            PARTIAL_INPUT,
            INVALID_DATA,
            DBUS_ERROR,
            HOST_UNREACHABLE,
            NETWORK_UNREACHABLE,
            CONNECTION_REFUSED,
            PROXY_FAILED,
            PROXY_AUTH_FAILED,
            PROXY_NEED_AUTH,
            PROXY_NOT_ALLOWED,
            BROKEN_PIPE,
            CONNECTION_CLOSED,
            NOT_CONNECTED,
            MESSAGE_TOO_LARGE,
        }

        class Cancellable {
            cancel (): void;
            static ['new'] (): Cancellable;
        }

        abstract class AsyncResult {
        }

        abstract class InputStream extends GObject.Object {
            close (cancellable: unknown | null): void;
        }

        abstract class FilterInputStream extends InputStream {
        }

        abstract class BufferedInputStream extends FilterInputStream {
        }

        class DataInputStream extends BufferedInputStream {
            static ['new'] (base_stream: InputStream): DataInputStream;
            read_line_utf8 (cancellable: unknown | null): [string, number];
        }

        enum SubprocessFlags {
            STDOUT_PIPE
        }

        class Subprocess extends GObject.Object {
            static ['new'] (argv: string[], flags: number): Subprocess;
            wait_check_async (cancellable: unknown | null, callback: (source: GObject.Object, result: AsyncResult) => void): void;
            wait_check_finish (result: AsyncResult): boolean;
            get_stdout_pipe (): InputStream;
            force_exit (): void;
        }

        abstract class OutputStream extends GObject.Object {
            write_all (byte_array: unknown, cancellable: unknown | null): [ok: boolean, bytes_written: number];
        }

        abstract class FileOutputStream extends OutputStream {
        }

        abstract class FileMonitor extends GObject.Object {
            cancel (): true;
        }

        abstract class File extends GObject.Object {
            x: boolean;
            static new_for_uri (path: string): File;
            static new_for_path (path: string): File;
            get_path (): string | null;
            get_parent (): File | null;
            get_basename (): string | null;
            create (flags: FileCreateFlags, cancellable: unknown | null): FileOutputStream | null;
            append_to (flags: FileCreateFlags, cancellable: unknown | null): FileOutputStream | null;
            load_contents (cancellable: unknown | null): [boolean, Uint8Array, string | null];
            replace_contents (contents: Uint8Array | string, etag: string | null, make_backup: boolean, flags: FileCreateFlags, cancellable: unknown | null): [boolean, string | null]
            make_directory_with_parents (cancellable: unknown | null): boolean;
            monitor (flags: FileMonitorFlags, cancellable: unknown | null): FileMonitor | null;
        }

        class AppLaunchContext extends GObject.Object {
        }

        abstract class AppInfo extends GObject.Object {
            static launch_default_for_uri (uri: string, context: AppLaunchContext): boolean;
        }

        abstract class Icon extends GObject.Object {
            static new_for_string (path: string): Icon;
        }
    }

    export default Gio;
}

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
    function gettext (msg: string): string;

    class Extension {
        path: string;

        metadata: {
            url: string,
            name: string,
            uuid: string,
            description: string,
            ['gettext-domain']: string,
            ['shell-version']: string[],
        };
    }
}

declare module 'gi://GLib' {
    namespace GLib {
        const PRIORITY_DEFAULT: number;

        abstract class Error {
            matches (domain: unknown, code: number): boolean;
        }

        function source_remove       (id: number): true;
        function timeout_add         (priority: number, timeout_ms: number, fn: Function): number;
        function timeout_add_seconds (priority: number, timeout: number, fn: Function): number;

        function get_home_dir (): string;
        function get_monotonic_time (): number;
        function markup_escape_text (text: string, length: number): string;
        function filename_to_uri (filename: string, hostname: string | null): string;
    }

    export default GLib;
}

declare module 'resource:///org/gnome/shell/ui/panel.js' {
    import St from 'gi://St';
    import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
    import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

    class Panel extends St.Widget {
        statusArea: { [key: string]: PanelMenu.Button };
        addToStatusArea (role: string, indicator: PanelMenu.Button, position: number, box: 'left' | 'center' | 'right'): PanelMenu.Button;
        menuManager: PopupMenu.PopupMenuManager;
    }
}

declare module 'gi://Meta' {
    namespace Meta {
        class Rectangle {
            x:      number;
            y:      number;
            width:  number;
            height: number;
        }

        enum Cursor {
            NONE,
            DEFAULT,
            NORTH_RESIZE,
            SOUTH_RESIZE,
            WEST_RESIZE,
            EAST_RESIZE,
            SE_RESIZE,
            SW_RESIZE,
            NE_RESIZE,
            NW_RESIZE,
            MOVE_OR_RESIZE_WINDOW,
            BUSY,
            DND_IN_DRAG,
            DND_MOVE,
            DND_COPY,
            DND_UNSUPPORTED_TARGET,
            POINTING_HAND,
            CROSSHAIR,
            IBEAM,
            BLANK,
            LAST,
        }

        enum LaterType {
            RESIZE,
            CALC_SHOWING,
            CHECK_FULLSCREEN,
            SYNC_STACK,
            BEFORE_REDRAW,
            IDLE,
        }

        function accelerator_name (state: unknown, sym: number): string;
        function external_binding_name_for_action (action: number): string;
    }

    export default Meta;
}

declare module 'resource:///org/gnome/shell/ui/layout.js' {
    import St from 'gi://St';
    import Meta from 'gi://Meta';
    import Clutter from 'gi://Clutter';
    import GObject from 'gi://GObject';

    class Monitor {
        index: number;
        x: number;
        y: number;
        width: number;
        height: number;
        geometry_scale: number;
    }

    class LayoutManager extends GObject.Object {
        uiGroup: St.Widget;
        dummyCursor: St.Widget;
        panelBox: St.BoxLayout;
        findMonitorForActor    (actor: Clutter.Actor): Monitor | null;
        findIndexForActor      (actor: Clutter.Actor): number;
        getWorkAreaForMonitor  (monitor_idx: number): Meta.Rectangle;
        setDummyCursorGeometry (x: number, y: number, width: number, height: number): void;
    }
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
    import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
    import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
    import { WindowManager } from 'resource:///org/gnome/shell/ui/windowManager.js';

    const wm: WindowManager;
    const panel: Panel.Panel;
    const layoutManager: Layout.LayoutManager;
    function notify (msg: string, banner?: string): void;
    function setThemeStylesheet (file: string): void;
    function loadTheme (): void;
}

declare module 'resource:///org/gnome/shell/ui/grabHelper.js' {
    import Clutter from 'gi://Clutter';

    class GrabHelper {
        constructor (owner: Clutter.Actor);
        grab (params: unknown): void;
        ungrab (params: unknown): void;
    }
}

declare module 'gi://GObject' {
    namespace GObject {
        class Object {
            constructor (...args: unknown[]);
            connect     (sig: string, callback: Function): number;
            disconnect  (id: number): void;
        }
    }

    export default GObject;
}

declare module 'gi://Graphene' {
    namespace Graphene {
        class Point3D {
            x: number;
            y: number;
            z: number;
            constructor (params?: { x?:number, y?:number, z?:number });
        }

        class Point {
            x: number;
            y: number;
        }

        class Rect {
            get_width (): number;
            get_height (): number;
            get_top_left (): Point;
            get_bottom_right (): Point;
        }
    }

    export default Graphene;
}

declare module 'gi://Cogl' {
    namespace Cogl {
        enum PixelFormat {
            RGB_888,
            RGBA_8888,
        }
    }

    export default Cogl;
}

declare module 'gi://GdkPixbuf' {
    namespace GdkPixbuf {
        class Pixbuf {
            static new_from_file_at_scale (path: string, w: number, height: number, keep_ratio: boolean): Pixbuf;
            static get_file_info (path: string): [unknown, number, number];
            width: number;
            height: number;
            rowstride: number;
            get_has_alpha (): boolean;
            read_pixel_bytes (): unknown;
        }
    }

    export default GdkPixbuf;
}

declare module 'gi://Pango' {
    import GObject from 'gi://GObject';

    namespace Pango {
        enum WrapMode {
            WORD,
            CHAR,
            WORD_CHAR,
        }

        enum EllipsizeMode {
            NONE,
            START,
            MIDDLE,
            END,
        }

        enum Alignment {
            LEFT,
            CENTER,
            RIGHT,
        }
    }

    export default Pango;
}

declare module 'gi://Shell' {
    namespace Shell {
        function util_get_week_start (): number;

        enum ActionMode {
            NONE          = 1 << 0,
            NORMAL        = 1 << 1,
            OVERVIEW      = 1 << 2,
            LOCK_SCREEN   = 1 << 3,
            UNLOCK_SCREEN = 1 << 4,
            LOGIN_SCREEN  = 1 << 5,
            SYSTEM_MODAL  = 1 << 6,
            LOOKING_GLASS = 1 << 7,
            POPUP         = 1 << 8,
            ALL           = -1,
        }
    }

    export default Shell;
}
