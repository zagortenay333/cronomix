// Url regex author: https://gist.github.com/dperini/729294
var URL = /^(?:(?:https?|ftp):\/\/)?(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,}))\.?)(?::\d{2,5})?(?:[/?#]\S*)?$/;

var FILE_PATH = /^~?\//;
var ISO_DATE  = /^\d{4}-\d{2}-\d{2}$/;

var TODO_CONTEXT        = /^@.+$/;
var TODO_PROJ           = /^\+.+$/;
var TODO_PRIO           = /^\([A-Z]\)$/;
var TODO_EXT            = /^[^:]+:[^:]+$/;
var TODO_PRIO_EXT       = /^(?:pri|PRI):[A-Z]$/;
var TODO_HIDE_EXT       = /^h:1$/;
var TODO_DEFER_EXT      = /^(?:t|defer):\d{4}-\d{2}-\d{2}$/;
var TODO_REC_EXT_1      = /^rec:[1-9][0-9]*[dw]$/;
var TODO_REC_EXT_2      = /^rec:x-[1-9][0-9]*[dw]$/;
var TODO_REC_EXT_3      = /^rec:[1-9][0-9]*d-[1-9][0-9]*m$/;
var TODO_DUE_EXT        = /^(?:due|DUE):\d{4}-\d{2}-\d{2}$/;
var TODO_TRACKER_ID_EXT = /^tracker_id:[^:]+$/;
