var DNDGroup = {
    TASK          : 'TASK',
    KANBAN_COLUMN : 'KANBAN_COLUMN',
};

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
    ALPHABET        : 'ALPHABET',
    RECURRENCE      : 'RECURRENCE',
    COMPLETED       : 'COMPLETED',
    CREATION_DATE   : 'CREATION_DATE',
    COMPLETION_DATE : 'COMPLETION_DATE',
};

var View = {
    CLEAR           : 'CLEAR',
    STATS           : 'STATS',
    SEARCH          : 'SEARCH',
    EDITOR          : 'EDITOR',
    DEFAULT         : 'DEFAULT',
    LOADING         : 'LOADING',
    SELECT_SORT     : 'SELECT_SORT',
    FILE_SWITCH     : 'FILE_SWITCH',
    SELECT_FILTER   : 'SELECT_FILTER',
    KANBAN_SWITCHER : 'KANBAN_SWITCHER',
};

var SORT_RECORD = () => [
    [SortType.PIN             , SortOrder.DESCENDING],
    [SortType.COMPLETED       , SortOrder.ASCENDING],
    [SortType.PRIORITY        , SortOrder.ASCENDING],
    [SortType.DUE_DATE        , SortOrder.ASCENDING],
    [SortType.RECURRENCE      , SortOrder.ASCENDING],
    [SortType.CONTEXT         , SortOrder.ASCENDING],
    [SortType.PROJECT         , SortOrder.ASCENDING],
    [SortType.CREATION_DATE   , SortOrder.ASCENDING],
    [SortType.COMPLETION_DATE , SortOrder.ASCENDING],
    [SortType.ALPHABET        , SortOrder.ASCENDING],
];

var FILTER_RECORD = () => ({
    invert_filters : false,
    deferred       : false,
    recurring      : false,
    hidden         : false,
    completed      : false,
    no_priority    : false,
    priorities     : [],
    contexts       : [],
    projects       : [],
    custom         : [],
    custom_active  : [],
});

var TODO_RECORD = () => ({
    name             : "",
    active           : false,
    todo_file        : "", // (file path)
    done_file        : "", // (file path or "")
    time_tracker_dir : "", // (file path or "")
    automatic_sort   : false,
    filters          : FILTER_RECORD(),
    sorts            : SORT_RECORD(),
});
