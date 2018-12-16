// Url regex author: https://gist.github.com/dperini/729294
var URL = /^\s*(?:(?:https?|ftp):\/\/)?(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,}))\.?)(?::\d{2,5})?(?:[/?#]\S*)?\s*$/;

var FILE_PATH = /^\s*~?\/\s*/;
var ISO_DATE  = /^\s*\d{4}-\d{2}-\d{2}\s*$/;

var TODO_CONTEXT        = /^\s*@.+\s*$/;
var TODO_PROJ           = /^\s*\+.+\s*$/;
var TODO_PRIO           = /^\s*\([A-Z]\)\s*$/;
var TODO_EXT            = /^\s*[^:]+:[^:]+\s*$/;
var TODO_PRIO_EXT       = /^\s*(?:pri|PRI):[A-Z]\s*$/;
var TODO_HIDE_EXT       = /^\s*h:1\s*$/;
var TODO_KANBAN_EXT     = /^\s*kan:.+\|.+\s*$/;
var TODO_PIN_EXT        = /^\s*pin:1\s*$/;
var TODO_DEFER_EXT      = /^\s*(?:t|defer):\d{4}-\d{2}-\d{2}\s*$/;
var TODO_REC_EXT_1      = /^\s*rec:[1-9][0-9]*[dw]\s*$/;
var TODO_REC_EXT_2      = /^\s*rec:x-[1-9][0-9]*[dw]\s*$/;
var TODO_REC_EXT_3      = /^\s*rec:[1-9][0-9]*d-[1-9][0-9]*m\s*$/;
var TODO_DUE_EXT        = /^\s*(?:due|DUE):\d{4}-\d{2}-\d{2}\s*$/;
var TODO_KANBAN_DUE     = /^\s*(?:due|DUE)([<=>]+)(\d+)([dwmy])$/;
var TODO_TRACKER_ID_EXT = /^\s*tracker_id:[^:]+\s*$/;
