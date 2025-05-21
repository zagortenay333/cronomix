
export class Token {
    tag;
    
    // The index of the first char and the index of
    // the last char + 1. So (end - start) === length.
    start;
    end;
    
    // The parsed int in case of a 'number' token.
    value;
}

// The lexer maintains a ring buffer of token objects that
// is the size set in this variable. This means that tokens
// returned by the lexer will eventually be overwritten. If
// you have to hold onto a token for too long, make a copy.
const MAX_TOKEN_LOOKAHEAD = 16;

// The max number of times you can peek without eating a
// token before we throw. It's an infinite loop guard.
const MAX_TOKEN_PEEK_COUNT = 100;

export class Lexer {
    on_token_eaten;
    
    #text;
    #cursor = 0;
    #peek_count = 0;
    
    #ring = new Array();
    #ring_count = 0;
    #ring_cursor = 0;
    
    constructor(text) {
        this.#text = text;
        for (let i = 0; i < MAX_TOKEN_LOOKAHEAD; ++i)
            this.#ring.push(new Token());
    }
    
    // If the given token is made of one character, then
    // return how many times this character is repeated
    // consecutively right after the token. That is, for
    // the string '***' calling this function on the first
    // asterisk token returns 3.
    get_token_repeats(token = this.peek_token()) {
        if (token.tag === 'eof' || token.end - token.start > 1)
            return 1;
        
        let cursor = token.start;
        const char = this.#text[cursor++];
        while (this.#text[cursor] === char)
            cursor++;
        
        return cursor - token.start;
    }
    
    get_token_text(token) {
        return this.#text.substring(token.start, token.end);
    }
    
    peek_token(n = 0) {
        if (n < 0 || n >= MAX_TOKEN_LOOKAHEAD)
            throw Error('Lexer trying to peek too far.');
        if (this.#peek_count++ === MAX_TOKEN_PEEK_COUNT)
            throw Error('Lexer not advancing.');
        while (this.#ring_count <= n)
            this.#build_token();
        return this.#ring[(this.#ring_cursor + n) % MAX_TOKEN_LOOKAHEAD];
    }
    
    try_peek_token(tag, nth = 0) {
        const token = this.peek_token(nth);
        return (token.tag === tag) ? token : null;
    }
    
    try_peek_tokens(tags) {
        for (const [idx, tag] of tags.entries())
            if (!this.try_peek_token(tag, idx))
                return false;
        return true;
    }
    
    peek_token_text(n = 0) {
        const token = this.peek_token(n);
        return this.get_token_text(token);
    }
    
    eat_token() {
        const token = this.peek_token();
        this.#peek_count = 0;
        this.#ring_count--;
        this.#ring_cursor = (this.#ring_cursor + 1) % MAX_TOKEN_LOOKAHEAD;
        this.on_token_eaten?.(token);
        return token;
    }
    
    try_eat_token(tag) {
        return this.try_peek_token(tag) ? this.eat_token() : null;
    }
    
    eat_tokens(n = 1) {
        while (n > 0) {
            this.eat_token();
            n--;
        }
    }
    
    eat_tokens_until(until) {
        while (true) {
            const token = this.peek_token();
            if (until(token) || token.tag === 'eof')
                break;
            this.eat_token();
        }
    }
    
    eat_line() {
        this.eat_tokens_until(t => t.tag === '\n');
        this.eat_token();
    }
    
    eat_whitespace() {
        while (true) {
            const t = this.peek_token().tag;
            if (t !== 'spaces' && t !== '\n' && t !== '\t')
                break;
            this.eat_token();
        }
    }
    
    #build_token() {
        const token = this.#ring[(this.#ring_cursor + this.#ring_count++) % MAX_TOKEN_LOOKAHEAD];
        token.start = this.#cursor;
        token.end = this.#cursor + 1;
        
        const C = this.#eat_char();
        
        if (C === ' ') {
            token.tag = 'spaces';
            while (this.#peek_char() === ' ') {
                token.end++;
                this.#eat_char();
            }
        }
        else if (this.#is_special_char(C)) {
            token.tag = C;
        }
        else if (this.#is_digit_char(C)) {
            token.tag = 'number';
            
            let len = 0;
            while (this.#is_digit_char(this.#peek_char())) {
                len++;
                this.#eat_char();
                if (len === 8)
                    token.tag = 'word';
            }
            
            token.end += len;
            if (token.tag === 'number')
                token.value = parseInt(this.#text.substring(token.start, token.end));
        }
        else {
            token.tag = 'word';
            
            while (true) {
                const c = this.#peek_char();
                if (this.#is_special_char(c))
                    break;
                token.end++;
                this.#eat_char();
            }
        }
    }
    
    #is_digit_char(ch) {
        return ch >= '0' && ch <= '9';
    }
    
    #is_special_char(ch) {
        switch (ch) {
            case '!':
            case '?':
            case '$':
            case '%':
            case '&':
            case '"':
            case '(':
            case ')':
            case '*':
            case '+':
            case '-':
            case '\'':
            case ',':
            case '.':
            case '/':
            case ':':
            case ';':
            case '\\':
            case '=':
            case '<':
            case '>':
            case '#':
            case '@':
            case '\t':
            case ' ':
            case '^':
            case '_':
            case '`':
            case '|':
            case '\n':
            case '{':
            case '}':
            case '~':
            case '[':
            case ']':
            case 'eof':
                return true;
        }
        
        return false;
    }
    
    #peek_char() {
        return (this.#cursor < this.#text.length) ? this.#text[this.#cursor] : 'eof';
    }
    
    #eat_char() {
        return (this.#cursor < this.#text.length) ? this.#text[this.#cursor++] : 'eof';
    }
}
