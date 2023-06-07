import { unreachable } from 'utils/misc';
import { Lexer, Token, TokenTag } from 'utils/markup/lexer';

export type Ast =
    | AstBlock
    | AstInline
    | AstFilter

export type AstBlock =
    | AstDummy
    | AstMeta
    | AstList
    | AstListItem
    | AstOrderedList
    | AstSeparator
    | AstRawBlock
    | AstHeader
    | AstTable
    | AstTableRow
    | AstTableCell
    | AstParagraph

export type AstInline =
    | AstSub
    | AstSup
    | AstLink
    | AstText
    | AstBold
    | AstStrike
    | AstItalic
    | AstTagRef
    | AstRawInline
    | AstHighlight

export type AstFilter =
    | AstFilterOr
    | AstFilterAnd
    | AstFilterNot
    | AstFilterAny
    | AstFilterDue
    | AstFilterDone
    | AstFilterPin
    | AstFilterHide
    | AstFilterTag
    | AstFilterTrack
    | AstFilterFuzzy
    | AstFilterString
    | AstFilterPriority

export abstract class AstBase { start!: number; end!: number; indent!: number; }

export class AstDummy          extends AstBase { readonly tag = 'AstDummy'; }
export class AstList           extends AstBase { readonly tag = 'AstList'; children = Array<AstListItem>(); }
export class AstListItem       extends AstBase { readonly tag = 'AstListItem'; children = Array<AstBlock>(); }
export class AstOrderedList    extends AstBase { readonly tag = 'AstOrderedList'; children = Array<AstListItem>(); }
export class AstSeparator      extends AstBase { readonly tag = 'AstSeparator'; }
export class AstRawBlock       extends AstBase { readonly tag = 'AstRawBlock'; children = Array<AstBlock>(); }
export class AstHeader         extends AstBase { readonly tag = 'AstHeader'; child!: AstParagraph; size!: number; }
export class AstParagraph      extends AstBase { readonly tag = 'AstParagraph'; children = Array<AstInline>(); }
export class AstTable          extends AstBase { readonly tag = 'AstTable'; children = Array<AstTableRow>(); }
export class AstTableRow       extends AstBase { readonly tag = 'AstTableRow'; children = Array<AstTableCell>(); }
export class AstTableCell      extends AstBase { readonly tag = 'AstTableCell'; children = Array<AstBlock>(); config!: Immutable<AstTableCellConfig>; }
export class AstMeta           extends AstBase { readonly tag = 'AstMeta'; config!: AstMetaConfig; children = Array<AstBlock>(); }
export class AstText           extends AstBase { readonly tag = 'AstText'; }
export class AstSub            extends AstBase { readonly tag = 'AstSub'; children = Array<AstInline>(); }
export class AstSup            extends AstBase { readonly tag = 'AstSup'; children = Array<AstInline>(); }
export class AstStrike         extends AstBase { readonly tag = 'AstStrike'; children = Array<AstInline>(); }
export class AstBold           extends AstBase { readonly tag = 'AstBold'; children = Array<AstInline>(); }
export class AstLink           extends AstBase { readonly tag = 'AstLink'; link!: string; alias!: string; }
export class AstItalic         extends AstBase { readonly tag = 'AstItalic'; children = Array<AstInline>(); }
export class AstHighlight      extends AstBase { readonly tag = 'AstHighlight'; children = Array<AstInline>(); }
export class AstRawInline      extends AstBase { readonly tag = 'AstRawInline'; children = Array<AstInline>(); monospace!: boolean; }
export class AstTagRef         extends AstBase { readonly tag = 'AstTagRef'; child!: AstText; }
export class AstFilterNot      extends AstBase { readonly tag = 'AstFilterNot'; op!: AstFilter; }
export class AstFilterOr       extends AstBase { readonly tag = 'AstFilterOr'; op1!: AstFilter; op2!: AstFilter; }
export class AstFilterAnd      extends AstBase { readonly tag = 'AstFilterAnd'; op1!: AstFilter; op2!: AstFilter; }
export class AstFilterAny      extends AstBase { readonly tag = 'AstFilterAny'; }
export class AstFilterDue      extends AstBase { readonly tag = 'AstFilterDue'; }
export class AstFilterDone     extends AstBase { readonly tag = 'AstFilterDone'; }
export class AstFilterPin      extends AstBase { readonly tag = 'AstFilterPin'; }
export class AstFilterHide     extends AstBase { readonly tag = 'AstFilterHide'; }
export class AstFilterTag      extends AstBase { readonly tag = 'AstFilterTag'; text!: string; }
export class AstFilterTrack    extends AstBase { readonly tag = 'AstFilterTrack'; id = -1; }
export class AstFilterFuzzy    extends AstBase { readonly tag = 'AstFilterFuzzy'; needle!: string; }
export class AstFilterString   extends AstBase { readonly tag = 'AstFilterString'; needle!: string; }
export class AstFilterPriority extends AstBase { readonly tag = 'AstFilterPriority'; priority = 0; }

export type Admonition = 'tip' | 'note' | 'warning' | 'important';

export class AstMetaConfig {
    priority?:   number;
    track?:      number;
    created?:    string;
    due?:        string;
    pin?:        boolean;
    done?:       boolean;
    hide?:       boolean;
    tags?:       Set<string>;
    image?:      { width?: number, path: string; }
    admonition?: Admonition;
}

export class AstTableCellConfig {
    width:  number|'*' = 1;
    height: number|'*' = 1;
    invisible = false;
}

export class Parser {
    #lex: Lexer;
    #text: string;
    #actual_indent = 0;
    #wanted_indent = -1;
    #start_of_line = true;
    #start_of_word = true;
    #trimming_tokens = false;
    #text_offset_adjustment = 0;
    #end_of_last_eaten_token = 0;
    #inside_raw_text_region = false;
    #stop_parsing_inline_at_newline = 0;
    #stop_parsing_inline_at = new Array<TokenTag[]>();
    #default_table_cell_config = new AstTableCellConfig();

    constructor (text: string) {
        this.#text = text;
        this.#lex  = new Lexer(text);
        this.#lex.on_token_eaten = this.#on_token_eaten.bind(this);
    }

    // For each top-level block this function will return a string
    // that is a copy of the markup text for this block, and the
    // start/end offsets of nodes in the returned AST begin at 0.
    * parse_blocks_split (): IterableIterator<[string, AstBlock]> {
        if (this.#wanted_indent !== -1) throw Error('This works only on the top-level.');

        this.#wanted_indent++;

        loop: while (true) {
            const parselet = this.#get_block_parselet();

            switch (parselet) {
            case 'eof':      break loop;
            case 'unindent': break loop;
            case 'blank':    this.#eat_blank_line(); break;

            default: {
                const start = this.#lex.peek_token().start;
                this.#text_offset_adjustment = start;
                const block = parselet.call(this);
                const text = this.#text.substring(start, block.end + this.#text_offset_adjustment);
                yield [text, block];
            } break;
            }
        }

        this.#wanted_indent--;
    }

    * parse_blocks (): IterableIterator<AstBlock> {
        this.#wanted_indent++;

        loop: while (true) {
            const parselet = this.#get_block_parselet();

            switch (parselet) {
            case 'eof':      break loop;
            case 'unindent': break loop;
            case 'blank':    this.#eat_blank_line(); break;
            default:         yield parselet.call(this); break;
            }
        }

        this.#wanted_indent--;
    }

    #try_eat_indent (): boolean {
        if (this.#actual_indent === -1) {
            const token = this.#lex.try_peek_token('spaces');

            if (! token) {
                this.#actual_indent = 0;
            } else {
                const indent = Math.floor((token.end - token.start) / 2);
                this.#actual_indent = Math.min(indent, this.#wanted_indent);

                // Trim token:
                token.start += 2 * this.#actual_indent;
                if (token.start >= token.end) {
                    this.#trimming_tokens = true;
                    this.#lex.eat_token();
                    this.#trimming_tokens = false;
                }
            }
        }

        return (this.#actual_indent === this.#wanted_indent);
    }

    #on_token_eaten (token: Token) {
        if (! this.#trimming_tokens) this.#end_of_last_eaten_token = token.end;

        if (token.tag === '\n') {
            this.#start_of_word = true;
            this.#start_of_line = true;
            this.#actual_indent = -1;
        } else {
            this.#start_of_word = (token.tag === 'spaces');
            this.#start_of_line = this.#start_of_line && this.#start_of_word;
        }
    }

    #eat_blank_line () {
        this.#trimming_tokens = true;
        this.#lex.eat_line();
        this.#trimming_tokens = false;
    }

    #make_node <T extends Ast> (ctor: Newable<T>): T {
        const result  = new ctor();
        result.indent = this.#wanted_indent;
        result.start  = this.#lex.peek_token().start - this.#text_offset_adjustment;
        return result;
    }

    #complete_node <T extends Ast> (node: T, lhs?: Ast): T {
        if (lhs) {
            node.start  = lhs.start;
            node.indent = lhs.indent;
        }

        node.end = this.#end_of_last_eaten_token - this.#text_offset_adjustment;
        return node;
    }

    #rest_of_line_is_blank (): boolean {
        const t1 = this.#lex.peek_token(0).tag;
        const t2 = this.#lex.peek_token(1).tag;
        return t1 === '\n' || (t1 === 'spaces' && t2 === '\n');
    }

    #get_block_parselet (): 'eof' | 'blank' | 'unindent' | (() => AstBlock) {
        const token = this.#lex.peek_token();

        if (token.tag === 'eof') return 'eof';
        if (this.#rest_of_line_is_blank()) return 'blank';
        if (this.#start_of_line && !this.#try_eat_indent()) return 'unindent';

        if (! this.#inside_raw_text_region) {
            const token   = this.#lex.peek_token();
            const repeats = this.#lex.get_token_repeats(token);

            if (token.tag === '#') return this.#parse_header;
            if (token.tag === '[' && repeats === 1) return this.#parse_meta;
            if (token.tag === '-' && repeats === 1) return this.#parse_list;
            if (token.tag === '|' && repeats === 1) return this.#parse_table;
            if (token.tag === '=' && repeats >= 3) return this.#parse_separator;
            if (token.tag === '>' && repeats === 1) return this.#parse_raw_block;
            if (token.tag === 'number' && this.#lex.try_peek_token('.', 1)) return this.#parse_ordered_list;
        }

        return this.#parse_paragraph;
    }

    #parse_meta (): AstMeta {
        const result = this.#make_node(AstMeta);

        this.#lex.eat_token();
        result.config = new AstMetaConfig();

        while (true) { // Parse configs:
            const token = this.#lex.peek_token();

            if (token.tag === 'eof') {
                break;
            } else if (token.tag === ']') {
                this.#lex.eat_token();
                this.#lex.try_eat_token('spaces');
                this.#lex.try_eat_token('\n');
                break;
            } else {
                const ok = this.#try_parse_meta_config(result.config);
                if (! ok) this.#lex.eat_tokens_until(this.#is_meta_config_delimiter);
            }
        }

        for (const b of this.parse_blocks()) result.children.push(b);
        return this.#complete_node(result);
    }

    #try_parse_meta_config (config: AstMetaConfig): boolean {
        const token = this.#lex.eat_token();
        const txt = this.#lex.get_token_text(token);

        if (txt === '@') {
            if (! this.#lex.try_peek_token('word')) return false;
            while (this.#lex.try_eat_token('word') || this.#lex.try_eat_token('_'));
            if (! this.#try_peek_meta_config_delimiter()) return false;
            config.tags ??= new Set<string>();
            config.tags.add(this.#text.substring(token.start, this.#end_of_last_eaten_token));
        } else if (txt === '#') {
            const t = this.#lex.eat_token();
            if (t.tag !== 'number') return false;
            if (! this.#try_peek_meta_config_delimiter()) return false;
            config.priority = t.value;
        } else if (txt === 'x') {
            if (! this.#try_peek_meta_config_delimiter()) return false;
            config.done = true;
        } else if (txt === 'hide') {
            if (! this.#try_peek_meta_config_delimiter()) return false;
            config.hide = true;
        } else if (txt === 'pin') {
            if (! this.#try_peek_meta_config_delimiter()) return false;
            config.pin = true;
        } else if (txt === 'due' || txt === 'created') {
            if (! this.#lex.try_eat_token(':')) return false;
            this.#lex.try_eat_token('spaces');
            const date = this.#try_parse_date();
            if (! date) return false;
            if (txt === 'due') config.due = date;
            else               config.created = date;
        } else if (txt === 'track') {
            if (! this.#lex.try_eat_token(':')) return false;
            this.#lex.try_eat_token('spaces');
            const t = this.#lex.eat_token();
            if (t.tag !== 'number') return false;
            config.track = t.value;
        } else if (txt === 'image') {
            this.#lex.try_eat_token('spaces');
            const width = this.#lex.try_eat_token('number')?.value ?? -1;
            this.#lex.try_eat_token('spaces');
            config.image = { path: this.#parse_text_until(this.#is_meta_config_delimiter) };
            if (width > 0) config.image.width = width;
        } else if (txt === 'tip' || txt === 'note' || txt === 'warning' || txt === 'important') {
            config.admonition = txt;
        }

        return true;
    }

    #try_parse_date (): string | null {
        const t0 = this.#lex.peek_token(0);
        const t1 = this.#lex.peek_token(1);
        const t2 = this.#lex.peek_token(2);
        const t3 = this.#lex.peek_token(3);
        const t4 = this.#lex.peek_token(4);
        const t5 = this.#lex.peek_token(5);

        if (t0.tag !== 'number' || t0.value > 9999) return null;
        if (t1.tag !== '-')                         return null;
        if (t2.tag !== 'number' || t2.value > 99)   return null;
        if (t3.tag !== '-')                         return null;
        if (t4.tag !== 'number' || t4.value > 99)   return null;
        if (! this.#is_meta_config_delimiter(t5))   return null;

        const text = this.#text.substring(t0.start, t4.end);
        this.#lex.eat_tokens(5);

        const invalid = Number.isNaN(new Date(text).valueOf());
        return invalid ? null : text;
    }

    #try_peek_meta_config_delimiter (n = 0): boolean {
        const token = this.#lex.peek_token(n);
        return this.#is_meta_config_delimiter(token);
    }

    #is_meta_config_delimiter (token: Token): boolean {
        const t = token.tag;
        return t === ']' || t === '\n' || t === 'eof' || t === 'spaces';
    }

    #get_filter_op_info (tag: AstFilter['tag']): [precendence: number, is_left_associative: boolean] {
        switch (tag) {
        case 'AstFilterNot':
            return [4, true];

        case 'AstFilterAnd':
            return [3, true];

        case 'AstFilterOr':
            return [2, true];

        case 'AstFilterDue':
        case 'AstFilterDone':
        case 'AstFilterAny':
        case 'AstFilterPin':
        case 'AstFilterHide':
        case 'AstFilterTag':
        case 'AstFilterTrack':
        case 'AstFilterFuzzy':
        case 'AstFilterString':
        case 'AstFilterPriority':
            return [1, true];

        default: unreachable(tag);
        }
    }

    try_parse_filter (lhs_precedence = 0): AstFilter | null {
        try {
            return this.#parse_filter(lhs_precedence);
        } catch {
            return null;
        }
    }

    #parse_filter (lhs_precedence = 0): AstFilter {
        let result = this.#parse_prefix_filter();

        while (true) {
            const [parselet, precedence, is_left_associative] = this.#get_infix_filter_parselet();
            if (precedence < lhs_precedence) break;
            if (precedence === lhs_precedence && is_left_associative) break;
            result = parselet.call(this, result);
        }

        return result;
    }

    #get_infix_filter_parselet (): [(lhs: AstFilter) => AstFilter, number, boolean] {
        this.#lex.eat_whitespace();
        const token = this.#lex.peek_token();

        switch (token.tag) {
        case '|': return [this.#parse_filter_or, ...this.#get_filter_op_info('AstFilterOr')];
        case '&': return [this.#parse_filter_and, ...this.#get_filter_op_info('AstFilterAnd')];
        default:  return [this.#parse_filter_nop, 0, true];
        }
    }

    #parse_prefix_filter (): AstFilter {
        this.#lex.eat_whitespace();
        const token = this.#lex.peek_token();

        switch (token.tag) {
        case '*':  return this.#parse_filter_any();
        case '@':  return this.#parse_filter_tag();
        case '!':  return this.#parse_filter_not();
        case '/':  return this.#parse_filter_fuzzy();
        case '\'': return this.#parse_filter_string();
        case '(':  return this.#parse_filter_parens();
        case '#':  return this.#parse_filter_priority();
        default:
            switch (this.#lex.get_token_text(token)) {
            case 'x':     return this.#parse_filter_done();
            case 'due':   return this.#parse_filter_due();
            case 'pin':   return this.#parse_filter_pin();
            case 'hide':  return this.#parse_filter_hide();
            case 'track': return this.#parse_filter_track();
            }
        }

        throw Error('Unrecognized expression.');
    }

    #parse_filter_any (): AstFilterAny {
        const result = this.#make_node(AstFilterAny);
        this.#lex.eat_token();
        return this.#complete_node(result);
    }

    #parse_filter_string (): AstFilterString {
        const result = this.#make_node(AstFilterString);

        this.#lex.eat_token();

        result.needle = this.#parse_text_until(token => {
            if (token.tag !== '\'') return false;
            this.#lex.eat_token();
            return true;
        });

        return this.#complete_node(result);
    }

    #parse_filter_fuzzy (): AstFilterFuzzy {
        const result = this.#make_node(AstFilterFuzzy);

        this.#lex.eat_token();

        result.needle = this.#parse_text_until(token => {
            if (token.tag !== '/') return false;
            this.#lex.eat_token();
            return true;
        });

        return this.#complete_node(result);
    }

    #parse_filter_tag (): AstFilterTag {
        const result = this.#make_node(AstFilterTag);
        let { start, end } = this.#lex.eat_token();
        if (this.#lex.try_peek_token('word')) end = this.#lex.eat_token().end;
        this.#complete_node(result);
        result.text = this.#text.substring(start, end);
        return result;
    }

    #parse_filter_priority (): AstFilterPriority {
        const result = this.#make_node(AstFilterPriority);
        this.#lex.eat_token();
        if (this.#lex.try_peek_token('number')) result.priority = this.#lex.eat_token().value;
        return this.#complete_node(result);
    }

    #parse_filter_done (): AstFilterDone {
        const result = this.#make_node(AstFilterDone);
        this.#lex.eat_token();
        return this.#complete_node(result);
    }

    #parse_filter_due (): AstFilterDue {
        const result = this.#make_node(AstFilterDue);
        this.#lex.eat_token();
        return this.#complete_node(result);
    }

    #parse_filter_pin (): AstFilterPin {
        const result = this.#make_node(AstFilterPin);
        this.#lex.eat_token();
        return this.#complete_node(result);
    }

    #parse_filter_hide (): AstFilterHide {
        const result = this.#make_node(AstFilterHide);
        this.#lex.eat_token();
        return this.#complete_node(result);
    }

    #parse_filter_track (): AstFilterTrack {
        const result = this.#make_node(AstFilterTrack);
        this.#lex.eat_token();

        if (this.#lex.try_eat_token(':')) {
            this.#lex.try_eat_token('spaces');
            const id = this.#lex.eat_token();
            if (id.tag !== 'number') throw Error('Missing filter track id.');
            result.id = id.value;
        }

        return this.#complete_node(result);
    }

    #parse_filter_not (): AstFilterNot {
        const result = this.#make_node(AstFilterNot);
        this.#lex.eat_token();
        result.op = this.#parse_filter(this.#get_filter_op_info(result.tag)[0]);
        return this.#complete_node(result);
    }

    #parse_filter_parens (): AstFilter {
        this.#lex.eat_token();
        const result = this.#parse_filter();
        this.#lex.eat_token();
        return result;
    }

    #parse_filter_and (lhs: AstFilter): AstFilterAnd {
        const result = this.#make_node(AstFilterAnd);
        result.op1 = lhs;
        this.#lex.eat_token();
        result.op2 = this.#parse_filter(this.#get_filter_op_info(result.tag)[0]);
        return this.#complete_node(result, lhs);
    }

    #parse_filter_or (lhs: AstFilter): AstFilterOr {
        const result = this.#make_node(AstFilterOr);
        result.op1 = lhs;
        this.#lex.eat_token();
        result.op2 = this.#parse_filter(this.#get_filter_op_info(result.tag)[0]);
        return this.#complete_node(result, lhs);
    }

    #parse_filter_nop (lhs: AstFilter): AstFilter {
        return lhs;
    }

    #parse_raw_block (): AstRawBlock {
        const result = this.#make_node(AstRawBlock);

        this.#lex.eat_token();
        this.#lex.try_eat_token('spaces');

        this.#inside_raw_text_region = true;
        for (const b of this.parse_blocks()) result.children.push(b);
        this.#inside_raw_text_region = false;

        return this.#complete_node(result);
    }

    #parse_separator (): AstSeparator {
        const result = this.#make_node(AstSeparator);
        this.#lex.eat_line();
        return this.#complete_node(result);
    }

    #parse_ordered_list (): AstOrderedList {
        const result = this.#make_node(AstOrderedList);

        while (this.#get_block_parselet() === this.#parse_ordered_list) {
            if (this.#lex.peek_token().value < result.children.length) break;
            this.#lex.eat_token();
            result.children.push(this.#parse_list_item());
        }

        return this.#complete_node(result);
    }

    #parse_list (): AstList {
        const result = this.#make_node(AstList);
        while (this.#get_block_parselet() === this.#parse_list) result.children.push(this.#parse_list_item());
        return this.#complete_node(result);
    }

    #parse_list_item (): AstListItem {
        const result = this.#make_node(AstListItem);
        this.#lex.eat_token();
        this.#lex.try_eat_token('spaces');
        this.#lex.try_eat_token('\n');
        for (const b of this.parse_blocks()) result.children.push(b);
        return this.#complete_node(result);
    }

    #parse_table (): AstTable {
        const result = this.#make_node(AstTable);
        if (this.#lex.try_peek_token('-', 1)) this.#lex.eat_line();
        while (this.#get_block_parselet() === this.#parse_table) result.children.push(this.#parse_table_row());
        return this.#complete_node(result);
    }

    #parse_table_row (): AstTableRow {
        const result = this.#make_node(AstTableRow);

        while (true) {
            if (this.#get_block_parselet() !== this.#parse_table) {
                this.#complete_node(result);
                break;
            } else if (this.#lex.try_peek_token('-', 1)) {
                this.#complete_node(result);
                this.#lex.eat_line();
                break;
            } else {
                result.children.push(this.#parse_table_cell());
            }
        }

        return result;
    }

    #parse_table_cell (): AstTableCell {
        const result = this.#make_node(AstTableCell);
        this.#lex.eat_token();
        result.config = this.#parse_table_cell_config();
        for (const b of this.parse_blocks()) result.children.push(b);
        return this.#complete_node(result);
    }

    #parse_table_cell_config (): Immutable<AstTableCellConfig> {
        if (! this.#lex.try_eat_token('[')) {
            this.#lex.try_eat_token('spaces');
            return this.#default_table_cell_config;
        }

        const result = new AstTableCellConfig();

        while (true) {
            const token = this.#lex.peek_token();

            if (token.tag === 'eof') {
                break;
            } else if (token.tag === '\n') {
                this.#lex.eat_token();
                break;
            } else if (token.tag === ']') {
                this.#lex.eat_token();
                this.#lex.try_eat_token('spaces');
                this.#lex.try_eat_token('\n');
                break;
            } else if (token.tag === '#') {
                this.#lex.eat_token();
                result.invisible = true;
            } else if (
                (token.tag === '*' || token.tag === 'number') &&
                this.#lex.try_peek_token(':', 1) &&
                (this.#lex.try_peek_token('*', 2) || this.#lex.try_peek_token('number', 2))
            ) {
                result.width = (token.tag === '*') ? '*' : Math.max(1, token.value);
                this.#lex.eat_token();
                this.#lex.eat_token();
                const t = this.#lex.eat_token();
                result.height = (t.tag === '*') ? '*' : Math.max(1, t.value);
            } else {
                this.#lex.eat_token();
            }
        }

        return result;
    }

    #parse_header (): AstHeader {
        const result = this.#make_node(AstHeader);

        result.size = Math.min(5, this.#lex.get_token_repeats());
        this.#lex.eat_tokens(result.size);
        this.#lex.try_eat_token('spaces');
        result.child = this.#parse_paragraph();

        return this.#complete_node(result);
    }

    #parse_paragraph (): AstParagraph {
        const result = this.#make_node(AstParagraph);
        this.#parse_inlines(result.children);
        return this.#complete_node(result);
    }

    #parse_inlines (output: AstInline[], delimiter?: TokenTag[]) {
        if (delimiter) this.#stop_parsing_inline_at.push(delimiter);

        while (true) {
            const parselet = this.#get_inline_parselet();
            if (! parselet) break;
            output.push(parselet.call(this));
        }

        if (delimiter) {
            this.#stop_parsing_inline_at.pop();
            if (this.#lex.try_peek_tokens(delimiter)) this.#lex.eat_tokens(delimiter.length);
        }
    }

    #get_inline_parselet (): (() => AstInline) | null {
        let token = this.#lex.peek_token();

        if (token.tag === 'eof') return null;
        if (token.tag === '\n' && this.#stop_parsing_inline_at_newline) return null;
        if (this.#start_of_line && this.#get_block_parselet() !== this.#parse_paragraph) return null;

        const delimiter = this.#stop_parsing_inline_at.at(-1);
        if (delimiter && this.#lex.try_peek_tokens(delimiter)) return null;

        if (! this.#inside_raw_text_region) {
            const token   = this.#lex.peek_token();
            const repeats = this.#lex.get_token_repeats(token);

            if (token.tag === '\\') {
                return this.#parse_escape;
            } else if (token.tag === '*') {
                if (repeats === 1) return this.#parse_italic;
                if (repeats === 2) return this.#parse_bold;
                if (repeats === 3) return this.#parse_highlight;
            } else if (token.tag === '~') {
                if (repeats === 1) return this.#parse_sub;
                if (repeats === 2) return this.#parse_strike;
            } else if (token.tag === '`') {
                if (repeats === 1 || repeats === 2) return this.#parse_raw_inline;
            } else if (token.tag === '^') {
                if (repeats === 1) return this.#parse_sup;
            } else if (token.tag === '<') {
                return this.#parse_link;
            } else if (token.tag === '@') {
                if (this.#start_of_word && this.#lex.try_peek_token('word', 1)) return this.#parse_tag_ref;
            }
        }

        return this.#parse_text;
    }

    #parse_link (): AstLink {
        const result = this.#make_node(AstLink);

        this.#lex.eat_token();

        result.link = this.#parse_text_until(token => {
            if (token.tag === '>') {
                return true;
            } else if (token.tag === ';') {
                this.#lex.eat_token();
                this.#lex.try_eat_token('spaces');
                return true;
            } else {
                return false;
            }
        });

        result.alias = this.#parse_text_until(token => {
            if (token.tag === '>') {
                this.#lex.eat_token();
                return true;
            } else {
                return false;
            }
        });

        return this.#complete_node(result);
    }

    #parse_tag_ref (): AstTagRef {
        const result = this.#make_node(AstTagRef);
        result.child = this.#make_node(AstText);
        this.#lex.eat_token();
        while (this.#lex.try_eat_token('word') || this.#lex.try_eat_token('_'));
        this.#complete_node(result.child);
        return this.#complete_node(result);
    }

    #parse_escape (): AstText {
        this.#lex.eat_token();
        return this.#parse_text();
    }

    #parse_italic (): AstItalic {
        const result = this.#make_node(AstItalic);
        this.#lex.eat_token();
        this.#parse_inlines(result.children, ['*']);
        return this.#complete_node(result);
    }

    #parse_bold (): AstBold {
        const result = this.#make_node(AstBold);
        this.#lex.eat_tokens(2);
        this.#parse_inlines(result.children, ['*', '*'])
        return this.#complete_node(result);
    }

    #parse_highlight (): AstHighlight {
        const result = this.#make_node(AstHighlight);
        this.#lex.eat_tokens(3);
        this.#parse_inlines(result.children, ['*', '*', '*']);
        return this.#complete_node(result);
    }

    #parse_sup (): AstSup {
        const result = this.#make_node(AstSup);
        this.#lex.eat_token();
        this.#stop_parsing_inline_at_newline++;
        this.#parse_inlines(result.children, ['^']);
        this.#stop_parsing_inline_at_newline--;
        return this.#complete_node(result);
    }

    #parse_sub (): AstSub {
        const result = this.#make_node(AstSub);
        this.#lex.eat_token();
        this.#stop_parsing_inline_at_newline++;
        this.#parse_inlines(result.children, ['~']);
        this.#stop_parsing_inline_at_newline--;
        return this.#complete_node(result);
    }

    #parse_strike (): AstStrike {
        const result = this.#make_node(AstStrike);
        this.#lex.eat_tokens(2);
        this.#parse_inlines(result.children, ['~', '~']);
        return this.#complete_node(result);
    }

    #parse_raw_inline (): AstRawInline {
        const result = this.#make_node(AstRawInline);

        this.#lex.eat_token();
        result.monospace = !!this.#lex.try_eat_token('`');

        this.#inside_raw_text_region = true;
        this.#parse_inlines(result.children, result.monospace ? ['`', '`'] : ['`']);
        this.#inside_raw_text_region = false;

        return this.#complete_node(result);
    }

    #parse_text (): AstText {
        const result = this.#make_node(AstText);

        while (true) {
            const token = this.#lex.eat_token();
            if (token.tag === '\n') break;
            if (this.#get_inline_parselet() !== this.#parse_text) break;
        }

        return this.#complete_node(result);
    }

    #parse_text_until (until: (token: Token) => boolean): string {
        let result = '';
        let start  = this.#lex.peek_token().start;

        while (true) {
            const token = this.#lex.peek_token();
            const end   = this.#end_of_last_eaten_token;

            if (token.tag === 'eof') {
                result += this.#text.substring(start, end);
                break;
            } else if (until(token)) {
                result += this.#text.substring(start, end);
                break;
            } else if (token.tag === '\\') {
                result += this.#text.substring(start, end);
                this.#lex.eat_token();
                start = this.#lex.eat_token().start;
            } else {
                this.#lex.eat_token();
            }
        }

        return result;
    }
}

// Translates an index into the innermost ast node containing
// it as as the path starting from the input @sibling nodes.
//
// If the index is not contained within any of the nodes, a
// nearby node will be returned. You only get an empty path
// back if input @siblings is empty.
export function idx_to_ast_path (idx: number, siblings: Ast[]): Ast[] {
    const result = Array<Ast>();

    if (siblings.length === 0) return result;
    if (idx < 0) idx = siblings.at(-1)!.end - 1;

    outer: while (true) {
        for (const node of siblings) {
            if (idx >= node.end) {
                // Below the sibling.
                continue;
            } else if (idx >= node.start) {
                // On the sibling.
                result.push(node);
                siblings = get_children(node);
                continue outer;
            } else if (node !== siblings[0]) {
                // Between siblings.
                result.push(node);
                break outer;
            } else {
                // Before the first sibling.
                if (result.length === 0) result.push(node);
                break outer;
            }
        }

        // Below the siblings.
        const last_sibling = siblings.at(-1);
        if (last_sibling) result.push(last_sibling);
        break;
    }

    return result;
}

export function filter_to_string (filter: AstFilter): string {
    const F = (filter: AstFilter): string => {
        switch (filter.tag) {
        case 'AstFilterOr':       return `(${F(filter.op1)} | ${F(filter.op2)})`;
        case 'AstFilterAnd':      return `(${F(filter.op1)} & ${F(filter.op2)})`;
        case 'AstFilterNot':      return `!${F(filter.op)}`;
        case 'AstFilterAny':      return '*';
        case 'AstFilterDue':      return 'due';
        case 'AstFilterDone':     return 'done';
        case 'AstFilterPin':      return 'pin';
        case 'AstFilterHide':     return 'hide';
        case 'AstFilterTag':      return filter.text;
        case 'AstFilterTrack':    return 'track' + ((filter.id > -1) ? `:${filter.id}` : '');
        case 'AstFilterFuzzy':    return `/${filter.needle}/`;
        case 'AstFilterString':   return `'${filter.needle}'`;
        case 'AstFilterPriority': return `#${filter.priority}`;
        default: unreachable(filter);
        }
    };

    const result = F(filter);
    return result.startsWith('(') ? result.substring(1, result.length - 1) : result;
}

export function * iter (nodes: Ast[]): IterableIterator<Ast> {
    for (const node of nodes) {
        yield node;
        yield* iter(get_children(node));
    }
}

export function get_children (node: Ast): Ast[] {
    switch (node.tag) {
    case 'AstText':
    case 'AstLink':
    case 'AstDummy':
    case 'AstSeparator':
    case 'AstFilterAny':
    case 'AstFilterDue':
    case 'AstFilterDone':
    case 'AstFilterPin':
    case 'AstFilterHide':
    case 'AstFilterTag':
    case 'AstFilterTrack':
    case 'AstFilterFuzzy':
    case 'AstFilterString':
    case 'AstFilterPriority':
        return [];

    case 'AstHeader':
    case 'AstTagRef':
        return [node.child];

    case 'AstList':
    case 'AstListItem':
    case 'AstOrderedList':
    case 'AstRawBlock':
    case 'AstParagraph':
    case 'AstTable':
    case 'AstTableRow':
    case 'AstTableCell':
    case 'AstMeta':
    case 'AstSub':
    case 'AstSup':
    case 'AstStrike':
    case 'AstBold':
    case 'AstItalic':
    case 'AstHighlight':
    case 'AstRawInline':
        return node.children;

    case 'AstFilterNot':
        return [node.op];

    case 'AstFilterOr':
    case 'AstFilterAnd':
        return [node.op1, node.op2];

    default: unreachable(node);
    }
}
