import {ColouredWord, WordColour} from './line-colouring';

/**
 * Paints coloured words with the CSS Custom Highlight API: nothing is added to the subtitle DOM, so the hover
 * outline, click lookup, hover pause and the text copied to Anki notes stay exactly as they are (Steph's approach).
 */
const HIGHLIGHT_NAMES: Record<WordColour, string> = {
  m: 'yall-gender-m',
  f: 'yall-gender-f',
  n: 'yall-gender-n',
  x: 'yall-gender-x'
};
const STYLE_ID = 'yall-word-colours';

export interface WordColours {
  masculine: string;
  feminine: string;
  neuter: string;
}

export function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/**
 * The `::highlight()` rules, kept in one <style> of the document. Literal colours rather than CSS variables, and
 * global rather than component styles: the subtitle spans come from innerHTML and carry no encapsulation attribute.
 */
export function applyWordColours(colours: WordColours, doc: Document = document): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = [
    `::highlight(${HIGHLIGHT_NAMES.m}) { color: ${colours.masculine}; }`,
    `::highlight(${HIGHLIGHT_NAMES.f}) { color: ${colours.feminine}; }`,
    `::highlight(${HIGHLIGHT_NAMES.n}) { color: ${colours.neuter}; }`,
    `::highlight(${HIGHLIGHT_NAMES.x}) { text-decoration: underline dotted; text-decoration-thickness: 2px; }`
  ].join('\n');
}

export function clearWordColours(): void {
  if (!highlightsSupported()) {
    return;
  }
  for (const name of Object.values(HIGHLIGHT_NAMES)) {
    CSS.highlights.delete(name);
  }
}

/**
 * The text nodes of a subtitle line and their text as it reads: inline tags join without a gap ("<b>Haus</b>tür" is
 * one word), a <br> or a block element is a line break.
 */
export interface LineText {
  text: string;
  nodes: Array<{ node: Text; start: number }>;
}

const BLOCK_TAGS = new Set(['BR', 'DIV', 'P', 'LI']);

export function readLineText(root: Element): LineText {
  const nodes: LineText['nodes'] = [];
  let text = '';
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (BLOCK_TAGS.has((node as Element).tagName) && text.length > 0 && !text.endsWith('\n')) {
        text += '\n';
      }
      continue;
    }
    const value = node.nodeValue ?? '';
    if (value) {
      nodes.push({node: node as Text, start: text.length});
      text += value;
    }
  }
  return {text, nodes};
}

/** The text node and offset of a position of the line: the node holding the character at it, or ending at it. */
function locate(line: LineText, position: number, atEnd: boolean): { node: Text; offset: number } | null {
  for (const n of line.nodes) {
    const length = (n.node.nodeValue ?? '').length;
    const inside = atEnd ? position > n.start && position <= n.start + length : position >= n.start && position < n.start + length;
    if (inside) {
      return {node: n.node, offset: position - n.start};
    }
  }
  return null;
}

export function paintWordColours(line: LineText, words: ColouredWord[]): void {
  if (!highlightsSupported()) {
    return;
  }
  const buckets: Record<WordColour, Highlight> = {m: new Highlight(), f: new Highlight(), n: new Highlight(), x: new Highlight()};
  for (const word of words) {
    // A range can span text nodes, so a word split by a tag is painted whole
    const start = locate(line, word.start, false);
    const end = locate(line, word.end, true);
    if (!start || !end) {
      continue;
    }
    try {
      const range = start.node.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      buckets[word.colour].add(range);
    } catch {
      // The node changed under us; the next paint fixes it
    }
  }
  for (const colour of Object.keys(buckets) as WordColour[]) {
    CSS.highlights.set(HIGHLIGHT_NAMES[colour], buckets[colour]);
  }
}
