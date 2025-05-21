import * as Misc from './misc.js';

export class PubSub {
    #next_id = 1;
    #handlers = new Map();
    #id_map = new Map();
    
    publish(event, msg) {
        const list = this.#handlers.get(event) ?? [];
        for (const handler of list)
            handler(msg);
    }
    
    subscribe(event, handler) {
        if (this.#next_id === Number.MAX_SAFE_INTEGER)
            return 0;
        
        const list = this.#handlers.get(event) ?? [];
        list.push(handler);
        this.#handlers.set(event, list);
        
        const id = this.#next_id++;
        this.#id_map.set(id, { event, handler });
        return id;
    }
    
    unsubscribe(id) {
        const handler = this.#id_map.get(id);
        if (!handler)
            return;
        this.#id_map.delete(id);
        
        const list = this.#handlers.get(handler.event);
        Misc.array_remove(list, handler.handler);
    }
    
    unsubscribe_all() {
        this.#next_id = 1;
        this.#id_map.clear();
        this.#handlers.clear();
    }
}
