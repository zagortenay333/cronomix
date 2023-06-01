import * as Misc from 'utils/misc';

export class PubSub <Events> {
    #next_id  = 1;
    #handlers = new Map<string, ((e:any) => void)[]>();
    #id_map   = new Map<number, { event: string, handler: (e:any) => void }>();

    publish <Event extends string & keyof Events> (
        event: Event,
        msg: Events[Event]
    ) {
        const list = this.#handlers.get(event) ?? [];
        for (const handler of list) handler(msg);
    }

    subscribe <Event extends string & keyof Events> (
        event: Event,
        handler: (msg: Events[Event]) => void
    ): number {
        if (this.#next_id === Number.MAX_SAFE_INTEGER) return 0;

        const list = this.#handlers.get(event) ?? [];
        list.push(handler);
        this.#handlers.set(event, list);

        const id = this.#next_id++;
        this.#id_map.set(id, { event, handler });
        return id;
    }

    unsubscribe (id: number) {
        const handler = this.#id_map.get(id);
        if (! handler) return;
        this.#id_map.delete(id);

        const list = this.#handlers.get(handler.event)!;
        Misc.array_remove(list, handler.handler);
    }

    unsubscribe_all () {
        this.#next_id = 1;
        this.#id_map.clear();
        this.#handlers.clear();
    }
}
