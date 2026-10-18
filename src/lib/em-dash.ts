// Em dashes are not allowed in anything a user can see. Source code that never
// reaches the screen (comments, identifiers, docs) is unaffected; these helpers
// exist to normalize strings on their way into the UI.

// U+2014 EM DASH and U+2015 HORIZONTAL BAR both render as a long dash.
const EM_DASH = /[—―]/;
const EM_DASH_RUN = /[ \t]*[—―]+[ \t]*/g;

export function hasEmDash(value: string) {
  return EM_DASH.test(value);
}

/**
 * Replaces em dashes with a hyphen, keeping the spacing readable: a dash
 * between words becomes " - ", and one that opens or closes a line only gets
 * the space it needs on the side that has text.
 */
export function stripEmDashes(value: string) {
  return value.replace(EM_DASH_RUN, (match, offset: number, whole: string) => {
    const atStart = offset === 0 || whole[offset - 1] === "\n";
    const end = offset + match.length;
    const atEnd = end === whole.length || whole[end] === "\n";

    if (atStart && atEnd) return "-";
    if (atStart) return "- ";
    if (atEnd) return " -";
    return " - ";
  });
}
