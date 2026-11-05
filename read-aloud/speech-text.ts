/**
 * Turn an assistant's Markdown reply into text that sounds right spoken:
 * code blocks are summarized, links read as their label, and markup that a
 * speech engine would pronounce ("asterisk", "pipe") is dropped.
 */
export function toSpeech(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");

  // Fenced blocks. Follow-up buttons and inline widgets are silent; real code
  // gets a short mention instead of being read character by character.
  text = text.replace(/^(`{3,}|~{3,})[ \t]*([^\n]*)\n[\s\S]*?\n?\1[ \t]*$/gm, (_m, _f, info: string) => {
    const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (lang === "next-steps" || lang === "inline-vis" || lang === "") {
      return lang === "" ? "\n(code block)\n" : "\n";
    }
    return `\n(${lang} code block)\n`;
  });
  // Unclosed fence (message cut mid-block): drop the rest.
  text = text.replace(/^(`{3,}|~{3,})[\s\S]*$/m, "\n(code block)\n");

  // bb directives and HTML.
  text = text.replace(/^::[a-z-]+\{[^}]*\}\s*$/gim, "");
  text = text.replace(/<\/?[a-z][^>]*>/gi, "");

  // Images, then links: read the label only.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `image: ${alt}` : "image"));
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/@thread:[A-Za-z0-9_]+(#msg=\d+)?/g, "a thread");
  text = text.replace(/\bhttps?:\/\/[^\s)]+/g, "a link");

  // Inline code keeps its content; long paths shrink to their file name.
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => shortenPath(code));

  // Tables: drop separator rows, turn cells into comma-separated phrases.
  text = text.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "");
  text = text.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", ") + ".",
  );

  // Headings, quotes, list markers, rules.
  text = text.replace(/^[ \t]{0,3}#{1,6}\s+(.*)$/gm, "$1.");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "");
  // List items: drop the marker and end with a pause so items don't run on.
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/gm, (_m, item: string) =>
    /[.!?:;,]$/.test(item.trim()) ? item : `${item}.`,
  );

  // Emphasis markers.
  text = text.replace(/(\*\*|__)(.+?)\1/g, "$2");
  text = text.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2");
  text = text.replace(/(^|\W)_(?!\s)([^_\n]+?)_(?!\w)/g, "$1$2");
  text = text.replace(/~~(.+?)~~/g, "$1");

  // Bare paths like src/foo/bar.ts:42 → "bar.ts".
  text = text.replace(/(?:^|\s)((?:~|\.{1,2})?\/?(?:[\w.-]+\/){2,}[\w.-]+(?::\d+)?)/g, (m, path: string) =>
    m.replace(path, shortenPath(path)),
  );

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();
}

function shortenPath(value: string): string {
  if (!/[/\\]/.test(value) || /\s/.test(value)) return value;
  const withoutLine = value.replace(/:\d+(:\d+)?$/, "");
  const parts = withoutLine.split(/[/\\]/).filter(Boolean);
  return parts.length > 2 ? (parts.at(-1) ?? value) : value;
}

/**
 * Split text into utterance-sized chunks. Long single utterances get cut off
 * or stall on some engines (Chrome stops after ~15s, iOS can drop them).
 */
export function chunkForSpeech(text: string, max = 220): string[] {
  const sentences = text
    .replace(/\n+/g, "\n")
    .split(/(?<=[.!?:;])\s+|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    for (const piece of splitLong(sentence, max)) {
      if (current !== "" && current.length + piece.length + 1 > max) {
        chunks.push(current);
        current = piece;
      } else {
        current = current === "" ? piece : `${current} ${piece}`;
      }
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(", ", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim() !== "") out.push(rest.trim());
  return out;
}
