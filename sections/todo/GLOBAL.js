const ME = imports.misc.extensionUtils.getCurrentExtension();

const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


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
