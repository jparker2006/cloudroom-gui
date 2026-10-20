export function outputMatchContexts(
  text: string,
  starts: Uint32Array,
  ends: Uint32Array,
) {
  let line = 1;
  let lineStart = 0;
  let newline = text.indexOf("\n");
  return Array.from(starts, (start, index) => {
    while (newline !== -1 && newline < start) {
      line++;
      lineStart = newline + 1;
      newline = text.indexOf("\n", lineStart);
    }
    return {
      line,
      excerpt: text.slice(
        Math.max(lineStart, start - 36),
        Math.min(newline === -1 ? text.length : newline, ends[index]! + 60),
      ),
    };
  });
}

export const MAX_OUTPUT_HIGHLIGHTS = 1_000;

export function mapOutputAnchor(
  previous: string,
  next: string,
  offset: number,
): number | null {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  )
    prefix++;
  if (offset < prefix || next.startsWith(previous)) return offset;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  if (offset >= previous.length - suffix)
    return offset + next.length - previous.length;
  return null;
}

export function searchOutputHtml(
  html: string,
  query: string,
  activeMatch: number | null = null,
) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const text = root.textContent ?? "";
  const capacity =
    query.length === 0 ? 0 : Math.floor(text.length / Array.from(query).length);
  const starts = new Uint32Array(capacity);
  const finishes = new Uint32Array(capacity);
  if (query.length === 0)
    return { html, text, matches: starts, ends: finishes };
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  let matchCount = 0;
  for (const match of text.matchAll(expression)) {
    starts[matchCount] = match.index;
    finishes[matchCount] = match.index + match[0].length;
    matchCount++;
  }
  const matches = starts.subarray(0, matchCount);
  const ends = finishes.subarray(0, matchCount);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  const activeOnly = matches.length > MAX_OUTPUT_HIGHLIGHTS;
  let index = activeOnly ? Math.min(activeMatch ?? 0, matches.length - 1) : 0;
  for (const node of nodes) {
    const value = node.data;
    const end = offset + value.length;
    if (index >= matches.length || matches[index]! >= end) {
      offset = end;
      continue;
    }
    const fragment = document.createDocumentFragment();
    let local = 0;
    while (index < matches.length && matches[index]! < end) {
      const from = Math.max(0, matches[index]! - offset);
      const to = Math.min(value.length, ends[index]! - offset);
      fragment.append(document.createTextNode(value.slice(local, from)));
      const mark = document.createElement("mark");
      mark.dataset.outputMatch = String(index);
      mark.className =
        "bg-warning/25 text-inherit outline-offset-1 data-[active=true]:bg-warning/60 data-[active=true]:outline data-[active=true]:outline-1 data-[active=true]:outline-foreground";
      mark.textContent = value.slice(from, to);
      fragment.append(mark);
      local = to;
      if (ends[index]! > end) break;
      index = activeOnly ? matches.length : index + 1;
    }
    fragment.append(document.createTextNode(value.slice(local)));
    node.replaceWith(fragment);
    offset = end;
  }
  const container = document.createElement("div");
  container.append(root);
  return { html: container.innerHTML, text, matches, ends };
}

export function escapedOutputHtml(output: string): string {
  return output
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
