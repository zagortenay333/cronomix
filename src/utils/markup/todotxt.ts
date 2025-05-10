import { Lexer } from './../../utils/markup/lexer.js';

export class TodoTxtParser {
    #lex: Lexer;
    #text: string;
    #done!: boolean;
    #priority!: string|null;
    #creation_date!: string|null;
    #completion_date!: string|null;
    #cronomix_markup!: string;

    constructor (text: string) {
        this.#lex = new Lexer(text);
        this.#text = text;
    }

    to_cronomix_markup (): string {
        this.#cronomix_markup = '';

        while (true) {
            if (this.#lex.peek_token().tag == 'eof') break;
            this.#parse_task();
        }

        return this.#cronomix_markup;
    }

    #parse_task () {
        this.#done = false;
        this.#priority = null;
        this.#creation_date = null;
        this.#completion_date = null;

        if (this.#lex.peek_token_text() === 'x') {
            this.#done = true;
            this.#lex.eat_token();
        }

        this.#lex.eat_whitespace();
        if ((this.#lex.peek_token(0).tag === '(') &&
            (this.#lex.peek_token(2).tag === ')') &&
            /[A-Z]/.test(this.#lex.peek_token_text(1))
        ) {
            this.#lex.eat_token();
            this.#priority = this.#lex.peek_token_text();
            this.#lex.eat_token();
            this.#lex.eat_token();
        }

        this.#lex.eat_whitespace();
        this.#creation_date = this.#try_parse_date();

        this.#lex.eat_whitespace();
        const d = this.#try_parse_date();
        if ((this.#creation_date !== null) && (d !== null)) {
            this.#completion_date = this.#creation_date;
            this.#creation_date = d;
        }

        this.#lex.eat_whitespace();
        const body_start = this.#lex.peek_token().start;
        let body_end: number;
        while (true) {
            const token = this.#lex.eat_token();
            if (token.tag === '\n') { body_end = token.end; break; }
        }

        const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.#cronomix_markup += "[";
        if (this.#done) this.#cronomix_markup += "x";
        if (this.#priority !== null) this.#cronomix_markup += " #" + (map.indexOf(this.#priority) + 1);
        if (this.#completion_date !== null) {
            this.#cronomix_markup += " completed:" + this.#completion_date;
            this.#cronomix_markup += " created:" + this.#creation_date;
        } else if (this.#creation_date !== null) {
            this.#cronomix_markup += " created:" + this.#creation_date;
        }
        this.#cronomix_markup += "] ";
        this.#cronomix_markup += this.#text.substring(body_start, body_end);
    }

    #try_parse_date (): string|null {
        const t0 = this.#lex.peek_token(0);
        const t1 = this.#lex.peek_token(1);
        const t2 = this.#lex.peek_token(2);
        const t3 = this.#lex.peek_token(3);
        const t4 = this.#lex.peek_token(4);

        if (t0.tag !== 'number' || t0.value > 9999) return null;
        if (t1.tag !== '-')                         return null;
        if (t2.tag !== 'number' || t2.value > 99)   return null;
        if (t3.tag !== '-')                         return null;
        if (t4.tag !== 'number' || t4.value > 99)   return null;

        const text = this.#text.substring(t0.start, t4.end);
        this.#lex.eat_tokens(5);

        const invalid = Number.isNaN(new Date(text).valueOf());
        return invalid ? null : text;
    }
}
