// (pattern, txt) -> score
//
// @pattern : string (pattern to look for)
// @txt     : string (text in which to look for pattern)
// @score   : int or null (a higher score means a better match; null means nothing matched)
//
// (This algorithm is currently used.)
//
// This is a simple linear algorithm (running in O(n), n = txt.length.) First we
// look ahead in txt to see if all the chars in the pattern appear in the text
// in the same order (excluding any gaps), then we loop back to see if there is
// a shorter version (saw this in fzf for vim.) If a single pattern letter is
// missing from the text, we return null.
//
//     a  b  c d e  abcdef
//     ----------------->|
//                  |<----
//
// This algorithm does not try to find the optimal match:
//     a b  c d  e ab c def  abcdef
//     ------------------>|
//                 |<------
//
// The score is computed based on how many consecutive letters in the text were
// found, whether the letters appear at word beginnings, number of gaps, etc.
function fuzzy_search_v1 (pattern, txt) {
    let txt_len  = txt.length;
    let patt_len = pattern.length;

    if (txt_len < patt_len) return null;

    let matches   = 0;
    let patt_pos  = 0;
    let start_pos = -1;

    for (var i = 0; i < txt_len; i++) {
        if (txt[i] === pattern[patt_pos]) {
            if (start_pos < 0) start_pos = i;
            if (++matches === patt_len) { i++; break; }
            patt_pos++;
        }
    }

    if (matches !== patt_len) return null;

    let gaps            = 0;
    let consecutives    = 0;
    let word_beginnings = 0;
    let last_match_idx  = 0;

    if (pattern[0] === txt[0]) word_beginnings++;

    while ((i--) > start_pos) {
        if (txt[i] === pattern[patt_pos]) {
            if ((i + 1) === last_match_idx) consecutives++;
            if ((i > 1) && /\W/.test(txt[i-1])) word_beginnings++;
            last_match_idx = i;
            patt_pos--;
        }
        else gaps++;
    }

    return (consecutives * 4) + (word_beginnings * 3) - gaps - start_pos;
}


// (pattern, txt) -> score
//
// @pattern : string (pattern to look for)
// @txt     : string (text in which to look for pattern)
// @score   : int or null (a higher score means a better match; null means nothing matched)
//
// This is an implementation of the Smith-Waterman algorithm with linear gaps.
// It runs in O(mn), m = pattern.length, n = txt.length. The Smith-Waterman algo
// cannot discard patterns, so a filtering scheme has to be implemented.
// Can't decide what the best way to filter would be.
function fuzzy_search_v2 (pattern, txt) {
    let patt_len = pattern.length;
    let txt_len  = txt.length;

    if (patt_len === 0) return 0;
    else if (txt_len === 0) return null;

    //
    // This filter kinda defeats the point of the Smith-Waterman algo.
    //
    // Check if txt has all the chars from pattern and whether they appear in
    // the same order, exluding any gaps between them.
    //
    let patt_idx = 0;

    for (let i = 0; i < txt_len; i++)
        if (txt[i] === pattern[patt_idx])
            patt_idx++;

    if (patt_len !== patt_idx) return null;

    //
    // initialize scoring matrix
    //
    let score  = 0;
    let matrix = [];

    i = patt_len + 1;
    while (i--) matrix[i] = [0];

    let j = txt_len + 1;
    while (j--) matrix[0][j] = 0;

    //
    // fill scoring matrix
    //
    let sub_cost = 0;
    for (j = 1; j <= txt_len; j++) {
        for (i = 1; i <= patt_len; i++) {
            sub_cost = (txt[j-1] === pattern[i-1]) ? 10 : -5;

            matrix[i][j] = Math.max(matrix[i-1][j-1] + sub_cost,
                                    matrix[i-1][j] - 3,
                                    matrix[i][j-1] - 3,
                                    0);

            if (matrix[i][j] > score) score = matrix[i][j];
        }
    }

    return score;
}


// (pattern, txt, k) -> levenshtein_distance
//
// @pattern : string (pattern to look for)
// @txt     : string (text in which to look for pattern)
// @k       : int    (max number of errors allowed)
// @levenshtein_distance: int (lower value means better match; 0 means perfect match)
//
// This is an implementation of the Sellers algorithm running in O(mn),
// m = pattern.length, n = txt.length.
// This algo finds the substring in txt with the lowest Levenshtein distance.
//
// Sellers algo by itself doesn't handle gaps between words. I.e., the user
// cannot type something like 'cbrow' to search for 'chromium browser'. To deal
// with this, the pattern should be broken into words and each word should be
// searched for using Sellers (not implemented here), and the combined scores
// (levenshtein distances) should be returned as the final score. The user
// would still need to type 'c brow' instead of 'cbrow' in that case.
function sellers_levenshtein (pattern, txt, k) {
    if (pattern === txt) return 0;

    let smallest_distance = k + 1;
    let prev_diag_value;
    let col = [0];
    let j;
    let i = pattern.length;

    while (i--) col[i] = i;

    for (j = 1; j <= txt.length; j++) {
        prev_diag_value = 0;

        for (i = 1; i <= pattern.length; i++) {
            [prev_diag_value, col[i]] = [col[i], prev_diag_value];

            if (pattern[i-1] === txt[j-1]) continue;
            else col[i] = 1 + Math.min(col[i], col[i-1], prev_diag_value);
        }

        if (col[i-1] === 0) return col[i-1];
        if (col[i-1] < smallest_distance) smallest_distance = col[i-1];
    }

    if (smallest_distance <= k) return smallest_distance;
    else return -1;
}
