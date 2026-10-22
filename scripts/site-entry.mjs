// Reuse the full Playground document at the site root. Keep navigation local to
// that document and rebase asset/docs URLs without assuming a deployment prefix.
export function createRootEntry(html) {
  return html.replace(/\b(src|href)(\s*=\s*)(["'])(\.\.?\/[^"']*)\3/g, (match, attribute, assignment, quote, value) => {
    if (value === './') return match;
    const target = new URL(value, 'https://build.invalid/playground/');
    return `${attribute}${assignment}${quote}.${target.pathname}${target.search}${target.hash}${quote}`;
  });
}
