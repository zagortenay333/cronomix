const ME = imports.misc.extensionUtils.getCurrentExtension();

const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const REG = ME.imports.lib.regex;


var SortOrder = {
    ASCENDING  : 'ASCENDING',
    DESCENDING : 'DESCENDING',
};


var SortType = {
    PIN             : 'PIN',
    CONTEXT         : 'CONTEXT',
    PROJECT         : 'PROJECT',
    PRIORITY        : 'PRIORITY',
    DUE_DATE        : 'DUE_DATE',
    RECURRENCE      : 'RECURRENCE',
    COMPLETED       : 'COMPLETED',
    CREATION_DATE   : 'CREATION_DATE',
    COMPLETION_DATE : 'COMPLETION_DATE',
};


var View = {
    CLEAR         : 'CLEAR',
    STATS         : 'STATS',
    SEARCH        : 'SEARCH',
    EDITOR        : 'EDITOR',
    DEFAULT       : 'DEFAULT',
    LOADING       : 'LOADING',
    SELECT_SORT   : 'SELECT_SORT',
    FILE_SWITCH   : 'FILE_SWITCH',
    SELECT_FILTER : 'SELECT_FILTER',
};


// return date string in yyyy-mm-dd format adhering to locale
function date_yyyymmdd (date_obj) {
    let now = date_obj || new Date();

    let month = now.getMonth() + 1;
    let day   = now.getDate();

    month = (month < 10) ? ('-' + 0 + month) : ('-' + month);
    day   = (day   < 10) ? ('-' + 0 + day)   : ('-' + day);

    return now.getFullYear() + month + day;
}


function date_delta_str (date) {
    let diff = Math.round(
        (Date.parse(date + 'T00:00:00') -
         Date.parse(date_yyyymmdd() + 'T00:00:00'))
        / 86400000);

    let abs = Math.abs(diff);

    let res;

    if (diff === 0)    res = _('today');
    else if (diff < 0) res = ngettext('%d day ago', '%d days ago', abs).format(abs);
    else               res = ngettext('in %d day', 'in %d days', abs).format(abs);

    return res.replace(/ /g, '&#160;'); // non-breaking-space
}


// @text: string
function multiline_to_single (text) {
    let new_text = '';

    let newline_counter = 0;

    for (let i = 0, len = text.length; i < len; i++) {
        if (text[i] === '\n') {
            newline_counter++;
        } else {
            if (newline_counter) {
                new_text += ' n:' + newline_counter + ' ';
                newline_counter = 0;
            }

            new_text += text[i];
        }
    }

    if (newline_counter) new_text += ' n:' + newline_counter + ' ';

    return new_text;
}


// @text: string
function single_to_multiline (text) {
    let new_text      = '';
    let is_line_start = true;

    text    = text.split(' ');
    let i   = 0;
    let len = text.length;

    if (text[0] === 'n:1') {
        text[0] = '';
        i++;
    }

    for (; i < len; i++) {
        let token = text[i];

        if (REG.TODO_NEWLINE_EXT.test(token)) {
            let n = +(token.slice(2))

            if      (n === 1) new_text += '\n';
            else if (n === 2) new_text += '\n\n';
            else              new_text += Array(n + 1).join('\n');

            is_line_start = true;
        } else {
            if (is_line_start) new_text += token;
            else               new_text += " " + token;

            is_line_start = false;
        }
    }

    return new_text;
}
