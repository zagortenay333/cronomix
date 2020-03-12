const Gst  = imports.gi.Gst;    Gst.init(null);
const GLib = imports.gi.GLib;
const Gio  = imports.gi.Gio;



// =====================================================================
// @@@ SoundPlayer
// =====================================================================
var SoundPlayer = class SoundPlayer {
    constructor () {
        this.sound_uri = '';
        this.playing   = false;

        this.playbin            = Gst.ElementFactory.make('playbin', 'play');
        this.playbin.audio_sink = Gst.ElementFactory.make('pulsesink', 'sink');

        this.prerolled = false;


        //
        // listen
        //
        let bus = this.playbin.get_bus();
        bus.add_signal_watch();

        bus.connect('message', (_, msg) => this._on_message_received(msg));
    }

    play (do_repeat = true) {
        if (this.playing || !this.sound_uri) return;

        if (do_repeat) {
            this.playbin.set_state(Gst.State.PLAYING);
            this.playing = true;
        } else {
            let file = Gio.file_new_for_uri(this.sound_uri);
            let player = global.display.get_sound_player();
            player.play_from_file(file, '', null);
        }
    }

    stop () {
        if (! this.playing) return;

        this.playbin.set_state(Gst.State.NULL);
        this.playing   = false;
        this.prerolled = false;
    }

    set_sound_uri (sound_uri) {
        this.sound_uri   = sound_uri;
        this.playbin.uri = sound_uri;
    }

    _on_message_received (msg) {
        if (! msg) return;

        if (msg.type == Gst.MessageType.SEGMENT_DONE) {
            this.playbin.seek_simple(Gst.Format.TIME, Gst.SeekFlags.SEGMENT, 0);
        }
        else if (msg.type == Gst.MessageType.ASYNC_DONE) {
            if (! this.prerolled) {
                this.playbin.seek_simple(Gst.Format.TIME, (Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT), 0);
                this.prerolled = true;
            }
        }

        return true;
    }
}
