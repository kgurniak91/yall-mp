import {applyWordColours, clearWordColours, highlightsSupported, paintWordColours, readLineText} from './word-colour-painter';

describe('word colour painter', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    clearWordColours();
    root.remove();
    document.getElementById('yall-word-colours')?.remove();
  });

  function rangesOf(name: string): string[] {
    const highlight = CSS.highlights.get(name);
    return highlight ? [...highlight].map(r => r.toString()) : [];
  }

  it('Chromium supports the Custom Highlight API', () => {
    expect(highlightsSupported()).toBeTrue();
  });

  it('reads the line as it reads: inline tags join without a gap, <br> is a line break', () => {
    root.innerHTML = 'ein <i>Haus</i><br>der Mann';
    const line = readLineText(root);
    expect(line.text).toBe('ein Haus\nder Mann');
    expect(line.nodes.map(n => n.start)).toEqual([0, 4, 9]);
  });

  it('keeps a literal line break as it is (pre-wrap subtitles)', () => {
    root.innerHTML = 'ein Haus\nder Mann';
    expect(readLineText(root).text).toBe('ein Haus\nder Mann');
  });

  it('paints each word, without touching the DOM', () => {
    root.innerHTML = 'ein <i>Haus</i><br>der Mann';
    const before = root.innerHTML;
    const line = readLineText(root);
    paintWordColours(line, [
      {start: 0, end: 3, colour: 'n'},
      {start: 4, end: 8, colour: 'n'},
      {start: 9, end: 12, colour: 'm'},
      {start: 13, end: 17, colour: 'm'}
    ]);
    expect(rangesOf('yall-gender-n')).toEqual(['ein', 'Haus']);
    expect(rangesOf('yall-gender-m')).toEqual(['der', 'Mann']);
    expect(rangesOf('yall-gender-f')).toEqual([]);
    expect(root.innerHTML).toBe(before);
  });

  it('paints a word split by a tag as one word', () => {
    root.innerHTML = 'die <b>Haus</b>tür';
    const line = readLineText(root);
    expect(line.text).toBe('die Haustür');
    paintWordColours(line, [{start: 0, end: 3, colour: 'f'}, {start: 4, end: 11, colour: 'f'}]);
    expect(rangesOf('yall-gender-f')).toEqual(['die', 'Haustür']);
  });

  it('marks two-gendered nouns separately', () => {
    root.textContent = "l'artiste";
    paintWordColours(readLineText(root), [{start: 2, end: 9, colour: 'x'}]);
    expect(rangesOf('yall-gender-x')).toEqual(['artiste']);
  });

  it('clears all colours', () => {
    root.textContent = 'der Mann';
    paintWordColours(readLineText(root), [{start: 4, end: 8, colour: 'm'}]);
    clearWordColours();
    expect(CSS.highlights.has('yall-gender-m')).toBeFalse();
  });

  it('writes the chosen colours into one style element', () => {
    applyWordColours({masculine: '#000001', feminine: '#000002', neuter: '#000003'});
    applyWordColours({masculine: '#4da3ff', feminine: '#ff6b9d', neuter: '#5fd068'});
    const styles = document.querySelectorAll('#yall-word-colours');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain('::highlight(yall-gender-m) { color: #4da3ff; }');
    expect(styles[0].textContent).toContain('::highlight(yall-gender-n) { color: #5fd068; }');
  });
});
