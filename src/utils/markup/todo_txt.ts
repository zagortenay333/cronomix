import * as P from './../../utils/markup/parser.js';
import { Lexer } from './../../utils/markup/lexer.js';

export class TodoTxtParser {
    #lex: Lexer;
    #text: string;
    #markup!: string;

    #done!: boolean;
    #pin!: boolean;
    #hide!: boolean;
    #priority!: string|null;
    #due_date!: string|null;
    #creation_date!: string|null;
    #completion_date!: string|null;

    constructor (text: string) {
        this.#lex = new Lexer(text);
        this.#text = text;
    }

    from_cronomix_markup (ast: P.AstMeta): string {
        const c = ast.config;

        let result = '';

        const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (c.done) result += 'x ';
        if (c.priority) {
            if (c.priority > 25) c.priority = 25;
            result += '(' + map[c.priority] + ') ';
        }
        // if (c.completion_date) result += c.completion_date + ' ';
        if (c.created) result += c.created + ' ';

        const body_start = ast.children[0].start;
        const body_end   = ast.end;
        result += this.#text.substring(body_start, body_end).replaceAll('\n', '\\n');

        result += '  '; // Indent to keep the following as part of 1 task.

        if (c.tags) {
            for (const tag of c.tags) {
                if (c.body_tags && c.body_tags.has(tag)) continue;
                result += ' ' + tag;
            }
        }

        if (c.hide) result += ' hide:1';
        if (c.pin)  result += ' pin:1';
        if (c.due)  result += ' due:' + c.due;

        result += '\n';
        return result;
    }

    to_cronomix_markup (): string {
        this.#markup = '';

        while (this.#lex.peek_token().tag != 'eof') {
            this.#done            = false;
            this.#pin             = false;
            this.#hide            = false;
            this.#priority        = null;
            this.#due_date        = null;
            this.#creation_date   = null;
            this.#completion_date = null;

            //
            // Parse header:
            //
            if (this.#lex.peek_token_text() === 'x') {
                this.#done = true;
                this.#lex.eat_token();
            }

            this.#lex.try_eat_token('spaces');
            if ((this.#lex.peek_token(0).tag === '(') &&
                (this.#lex.peek_token(2).tag === ')') &&
                /[A-Z]/.test(this.#lex.peek_token_text(1))
            ) {
                this.#lex.eat_token();
                this.#priority = this.#lex.peek_token_text();
                this.#lex.eat_token();
                this.#lex.eat_token();
            }

            this.#lex.try_eat_token('spaces');
            this.#creation_date = this.#try_parse_date();

            this.#lex.try_eat_token('spaces');
            const d = this.#try_parse_date();
            if ((this.#creation_date !== null) && (d !== null)) {
                this.#completion_date = this.#creation_date;
                this.#creation_date = d;
            }

            //
            // Parse body:
            //
            let body   = '';
            let cursor = this.#lex.peek_token().start;

            while (true) {
                const token = this.#lex.eat_token();

                if (token.tag === '\\' && this.#lex.peek_token_text() === 'n') {
                    body += this.#text.substring(cursor, token.start);
                    body += '\n';
                    this.#lex.eat_token();
                    cursor = this.#lex.peek_token().start;
                } else if (
                    this.#lex.get_token_text(token) === 'due' &&
                    this.#lex.peek_token().tag      === ':'
                ) {
                    body += this.#text.substring(cursor, token.start);
                    this.#lex.eat_token();
                    this.#due_date = this.#try_parse_date();
                    if (! this.#due_date) body += 'due:';
                    this.#lex.try_eat_token('spaces');
                    cursor = this.#lex.peek_token().start;
                } else if (
                    this.#lex.get_token_text(token) === 'h' &&
                    this.#lex.peek_token().tag      === ':' &&
                    this.#lex.peek_token_text(1)    === '1'
                ) {
                    body += this.#text.substring(cursor, token.start);
                    this.#lex.eat_tokens(2);
                    this.#hide = true;
                    this.#lex.try_eat_token('spaces');
                    cursor = this.#lex.peek_token().start;
                } else if (
                    this.#lex.get_token_text(token) === 'pin' &&
                    this.#lex.peek_token().tag      === ':' &&
                    this.#lex.peek_token_text(1)    === '1'
                ) {
                    body += this.#text.substring(cursor, token.start);
                    this.#lex.eat_tokens(2);
                    this.#pin = true;
                    this.#lex.try_eat_token('spaces');
                    cursor = this.#lex.peek_token().start;
                } else if (token.tag === '\n' || token.tag === 'eof') {
                    body += this.#text.substring(cursor, token.end);
                    break;
                }
            }

            //
            // Generate the cronomix markup:
            //
            const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            this.#markup += "[";
            if (this.#done) this.#markup += "x";
            if (this.#hide) this.#markup += " hide";
            if (this.#pin) this.#markup += " pin";
            if (this.#priority !== null) this.#markup += " #" + (map.indexOf(this.#priority) + 1);
            if (this.#due_date !== null) this.#markup += " due:" + this.#due_date;
            if (this.#completion_date !== null) {
                this.#markup += " completed:" + this.#completion_date;
                this.#markup += " created:" + this.#creation_date;
            } else if (this.#creation_date !== null) {
                this.#markup += " created:" + this.#creation_date;
            }
            this.#markup += "] ";
            this.#markup += body;
        }

        log(this.#markup);
        return this.#markup;
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

        const text    = this.#text.substring(t0.start, t4.end);
        const invalid = Number.isNaN(new Date(text).valueOf());

        if (invalid) {
            return null;
        } else {
            this.#lex.eat_tokens(5);
            return text;
        }
    }
}
