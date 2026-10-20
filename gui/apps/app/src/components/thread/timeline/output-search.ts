export interface OutputMatch {
  start: number;
  end: number;
  line: number;
  excerpt: string;
}

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

export function searchOutputHtml(html: string, query: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const text = root.textContent ?? "";
  const matches: OutputMatch[] = [];
  if (query.length === 0) return { html, text, matches };
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  let line = 1;
  let lineStart = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    let newline = text.indexOf("\n", lineStart);
    while (newline !== -1 && newline < start) {
      line++;
      lineStart = newline + 1;
      newline = text.indexOf("\n", lineStart);
    }
    matches.push({
      start,
      end: start + match[0].length,
      line,
      excerpt: text.slice(
        Math.max(lineStart, start - 36),
        Math.min(
          newline === -1 ? text.length : newline,
          start + match[0].length + 60,
        ),
      ),
    });
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  let index = 0;
  for (const node of nodes) {
    const value = node.data;
    const end = offset + value.length;
    const fragment = document.createDocumentFragment();
    let local = 0;
    while (index < matches.length && matches[index]!.start < end) {
      const match = matches[index]!;
      const from = Math.max(0, match.start - offset);
      const to = Math.min(value.length, match.end - offset);
      fragment.append(document.createTextNode(value.slice(local, from)));
      const mark = document.createElement("mark");
      mark.dataset.outputMatch = String(index);
      mark.className =
        "bg-warning/25 text-inherit outline-offset-1 data-[active=true]:bg-warning/60 data-[active=true]:outline data-[active=true]:outline-1 data-[active=true]:outline-foreground";
      mark.textContent = value.slice(from, to);
      fragment.append(mark);
      local = to;
      if (match.end > end) break;
      index++;
    }
    fragment.append(document.createTextNode(value.slice(local)));
    node.replaceWith(fragment);
    offset = end;
  }
  const container = document.createElement("div");
  container.append(root);
  return { html: container.innerHTML, text, matches };
}

export function escapedOutputHtml(output: string): string {
  return output
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
