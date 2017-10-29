const ME = imports.misc.extensionUtils.getCurrentExtension();

const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


var SortOrder = {
    ASCENDING  : 'ASCENDING',
    DESCENDING : 'DESCENDING',
};


var SortType = {
    CONTEXT         : 'CONTEXT',
    PROJECT         : 'PROJECT',
    PRIORITY        : 'PRIORITY',
    DUE_DATE        : 'DUE_DATE',
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
    NO_TODO_FILE  : 'NO_TODO_FILE',
    SELECT_FILTER : 'SELECT_FILTER',
};


var REG_CONTEXT        = /^@.+$/;
var REG_PROJ           = /^\+.+$/;
var REG_PRIO           = /^\([A-Z]\)$/;
var REG_DATE           = /^\d{4}-\d{2}-\d{2}$/;
var REG_EXT            = /^[^:]+:[^:]+$/;
var REG_FILE_PATH      = /^~?\//;
var REG_PRIO_EXT       = /^(?:pri|PRI):[A-Z]$/;
var REG_HIDE_EXT       = /^h:1$/;
var REG_DEFER_EXT      = /^(?:t|defer):\d{4}-\d{2}-\d{2}$/;
var REG_TRACKER_ID_EXT = /^tracker_id:[^:]+$/;
var REG_REC_EXT_1      = /^rec:[1-9][0-9]*[dw]$/;
var REG_REC_EXT_2      = /^rec:x-[1-9][0-9]*[dw]$/;
var REG_REC_EXT_3      = /^rec:[1-9][0-9]*d-[1-9][0-9]*m$/;
var REG_DUE_EXT        = /^(?:due|DUE):\d{4}-\d{2}-\d{2}$/;
var REG_URL            = /^\b((?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?]))$/;


// return date string in yyyy-mm-dd format adhering to locale
function date_yyyymmdd (date_obj) {
    let now = date_obj || new Date();

    let month = now.getMonth() + 1;
    let day   = now.getDate();

    month = (month < 10) ? ('-' + 0 + month) : ('-' + month);
    day   = (day   < 10) ? ('-' + 0 + day)   : ('-' + day);

    return now.getFullYear() + month + day;
}


// This function splits the @str into words at spaces and returns array of
// those words.
// Escaped spaces ('\ ') are included in their respective words as well as the
// backslash. E.g., ['as\ df', 'qwert\ y', ...].
function split_on_spaces (str) {
    let words = [];
    let i, word;

    if (str.startsWith('\\ ')) {
        i    = 2;
        word = ' ';
    }
    else {
        i    = 1;
        word = (str[0] === ' ') ? '' : str[0];
    }

    for (let len = str.length; i < len; i++) {
        if (str[i] === ' ') {
            if (str[i - 1] === '\\') {
                word += ' ';
            }
            else if (word) {
                words.push(word);
                word = '';
            }
        }
        else {
            word += str[i];
        }
    }

    if (word) words.push(word);

    return words;
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
