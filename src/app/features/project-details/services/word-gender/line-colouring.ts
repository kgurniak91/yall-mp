/**
 * Colours one subtitle line: splits it into words, looks the candidates up, and gives articles/determiners the
 * colour of their noun. Pure apart from the lookup function it is given, so it is tested with recorded responses.
 *
 * The German sentence rules (capitalised nouns, the sentence-initial re-check, agreement, relative pronouns, "das
 * der") come from Steph's (@stephdolgo) gender-german.js; the article languages reuse the agreement with their own
 * word lists (language-packs.ts).
 */
import {entryIsNoun, Gender, GenderVerdict, hasAdjectiveReading, hasVerbReading, matchesWholeWord, PreparedTagNames, readGender, ReadMode, TermsFindResult} from './gender-reader';
import {LanguagePack} from './language-packs';

/** m/f/n, or x: a noun with two genders, marked rather than coloured. */
export type WordColour = Gender | 'x';

export interface ColouredWord {
  start: number;
  end: number;
  colour: WordColour;
}

export type AmbiguousMode = 'mark' | 'first' | 'skip';

export interface LineColouringOptions {
  language: string;
  pack: LanguagePack;
  tags: PreparedTagNames;
  /** Colour articles and determiners like the noun they belong to. */
  articles: boolean;
  ambiguous: AmbiguousMode;
  /** Yomitan `termsFind` (exact, deinflect) for one word, cached by the caller; null when there is no answer. */
  lookup: (word: string) => Promise<TermsFindResult | null>;
}

interface Token {
  start: number;
  end: number;
  word: string;
  lower: string;
  isDeterminer: boolean;
  capitalised: boolean;
  initial: boolean;
  relative: boolean;
  /** Read right after a determiner, and could also be an adjective ("une belle ..."). */
  adjectiveAfterDeterminer: boolean;
  /** Set for nouns after the lookups; for determiners by agreement. */
  colour: WordColour | null;
}

const MIN_LOOKUP_LENGTH = 2;

/** Quotes, dashes and brackets that can sit between the end of a sentence and the next word. */
const OPENERS = new Set(['"', '\'', '«', '»', '„', '“', '”', '‚', '‘', '’', '(', '[', '{', '-', '–', '—', '*', '♪', '♫', '¿', '¡']);
const SENTENCE_END = '.!?…:;';
/** Punctuation that ends a noun phrase: an article never agrees across it. */
const PHRASE_BREAK = /[.,;:!?…()\[\]"«»„“”—–]/u;

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(language: string): Intl.Segmenter {
  let s = segmenters.get(language);
  if (!s) {
    try {
      s = new Intl.Segmenter(language, {granularity: 'word'});
    } catch {
      s = new Intl.Segmenter('en', {granularity: 'word'});
    }
    segmenters.set(language, s);
  }
  return s;
}

function lowerCase(word: string, language: string): string {
  try {
    return word.toLocaleLowerCase(language);
  } catch {
    return word.toLowerCase();
  }
}

/** Determiner lists use a straight apostrophe. */
function normaliseApostrophe(word: string): string {
  return word.replace(/’/g, '\'');
}

/** True if nothing but sentence-ending punctuation (or the start of the line) comes before this word. */
function isSentenceInitial(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (/\s/u.test(ch) || OPENERS.has(ch)) {
      continue;
    }
    return SENTENCE_END.includes(ch);
  }
  return true;
}

/**
 * German: a determiner right after a comma (optionally with one preposition between, ", in der") is a relative
 * pronoun; it points back to the noun before the comma, not forward.
 */
function isRelativePronoun(text: string, index: number, lower: string, pack: LanguagePack, language: string): boolean {
  const rel = pack.relativePronouns;
  if (!rel || !rel.forms.has(lower)) {
    return false;
  }
  let i = index - 1;
  const skipSpace = () => {
    while (i >= 0 && /\s/u.test(text[i])) {
      i--;
    }
  };
  skipSpace();
  if (i < 0) {
    return false;
  }
  if (text[i] === ',') {
    return true;
  }
  const end = i + 1;
  while (i >= 0 && /\p{L}/u.test(text[i])) {
    i--;
  }
  const preceding = lowerCase(text.slice(i + 1, end), language);
  if (!preceding || !rel.prepositions.has(preceding)) {
    return false;
  }
  skipSpace();
  return i >= 0 && text[i] === ',';
}

function tokenize(text: string, options: LineColouringOptions): Token[] {
  const {pack, language} = options;
  const tokens: Token[] = [];
  const push = (start: number, word: string) => {
    const lower = lowerCase(word, language);
    const normalised = normaliseApostrophe(lower);
    const isDeterminer = pack.determiners.has(normalised);
    tokens.push({
      start,
      end: start + word.length,
      word,
      lower,
      isDeterminer,
      capitalised: word[0] !== lower[0],
      initial: isSentenceInitial(text, start),
      relative: isDeterminer && isRelativePronoun(text, start, lower, pack, language),
      adjectiveAfterDeterminer: false,
      colour: null
    });
  };

  for (const seg of segmenter(language).segment(text)) {
    if (!seg.isWordLike) {
      continue;
    }
    const word = seg.segment;
    // "l'eau" -> "l'" + "eau"
    if (pack.elisions.size > 0) {
      const m = /^(\p{L}+['’])(\p{L}.*)$/u.exec(word);
      if (m && pack.elisions.has(normaliseApostrophe(lowerCase(m[1], language)))) {
        push(seg.index, m[1]);
        push(seg.index + m[1].length, m[2]);
        continue;
      }
    }
    push(seg.index, word);
  }
  return tokens;
}

function verdictToColour(verdict: GenderVerdict, ambiguous: AmbiguousMode): WordColour | null {
  if (!verdict) {
    return null;
  }
  if (verdict.genders.length === 1) {
    return verdict.genders[0];
  }
  return ambiguous === 'mark' ? 'x' : ambiguous === 'first' ? verdict.genders[0] : null;
}

/** Is there phrase-ending punctuation between two tokens? */
function brokenBetween(text: string, a: Token, b: Token): boolean {
  return PHRASE_BREAK.test(text.slice(a.end, b.start));
}

interface Lookup {
  /** The spelling looked up (lowercased at a sentence start outside German). */
  word: string;
  result: TermsFindResult | null;
  /** German, sentence-initial capital: the lowercase spelling, for the "Hast du Zeit?" check. */
  lowerResult?: TermsFindResult | null;
}

/** Looks up every candidate word of the line at once (the caller's cache makes repeats free). */
async function lookUpCandidates(tokens: Token[], options: LineColouringOptions): Promise<Array<Lookup | null>> {
  const {pack, lookup} = options;
  return Promise.all(tokens.map(async token => {
    if (token.isDeterminer || token.word.length < MIN_LOOKUP_LENGTH || (pack.capitalisedNounsOnly && !token.capitalised)) {
      return null;
    }
    // Outside German a capital at the start of a sentence is only the sentence: "Maison" is looked up as "maison"
    const word = !pack.capitalisedNounsOnly && token.initial && token.capitalised ? token.lower : token.word;
    const germanInitial = pack.capitalisedNounsOnly && token.initial && token.lower !== token.word;
    const [result, lowerResult] = await Promise.all([lookup(word), germanInitial ? lookup(token.lower) : Promise.resolve(undefined)]);
    return {word, result, lowerResult};
  }));
}

/**
 * Where the word stands relative to an article: right after it ("la porte": must be a noun, even when a verb ranks
 * first), after it and one possible adjective ("une belle voiture": the top reading counts, a verb reading lower
 * down does not make it a verb), or neither.
 */
function placeAfterDeterminer(text: string, tokens: Token[], lookups: Array<Lookup | null>, index: number): 'direct' | 'afterAdjective' | null {
  const token = tokens[index];
  const previous = tokens[index - 1];
  if (!previous || brokenBetween(text, previous, token)) {
    return null;
  }
  if (previous.isDeterminer) {
    return 'direct';
  }
  const beforePrevious = tokens[index - 2];
  return beforePrevious && beforePrevious.isDeterminer && !brokenBetween(text, beforePrevious, previous) &&
  hasAdjectiveReading(lookups[index - 1]?.result) ? 'afterAdjective' : null;
}

/** Gives each looked-up word its colour, in line order (a word's reading can depend on the words before it). */
function classifyNouns(text: string, tokens: Token[], lookups: Array<Lookup | null>, options: LineColouringOptions): void {
  const {pack, tags} = options;
  tokens.forEach((token, index) => {
    const looked = lookups[index];
    if (!looked) {
      return;
    }
    const place = pack.determinerDecidesHomographs ? placeAfterDeterminer(text, tokens, lookups, index) : null;
    const mode: ReadMode = place === 'direct' ? 'firstNoun' : 'top';
    let verdict = readGender(looked.result, looked.word, tags, mode);

    // A noun/verb or noun/adjective homograph with no article in front reads as the verb or the adjective:
    // "il porte", "él habla", "son grandes"
    if (verdict && pack.determinerDecidesHomographs && !place && (hasVerbReading(looked.result) || hasAdjectiveReading(looked.result))) {
      verdict = null;
    }

    // German: a capital at the start of a sentence proves nothing ("Hast du Zeit?" is haben). If the lowercase
    // spelling is something other than a noun, leave the word plain.
    const lower = looked.lowerResult;
    if (verdict && lower !== undefined && matchesWholeWord(lower, token.lower) && !entryIsNoun(lower!.dictionaryEntries![0], tags)) {
      verdict = null;
    }

    token.adjectiveAfterDeterminer = mode === 'firstNoun' && hasAdjectiveReading(looked.result);
    token.colour = verdictToColour(verdict, options.ambiguous);
  });
}

/**
 * Article languages: "une belle voiture", "un grand homme". Right after an article a word that can be an adjective
 * and is followed by another noun is the adjective, not a noun of its own; it stays plain and the article agrees
 * with the noun after it.
 */
function dropAdjectivesBeforeNouns(text: string, tokens: Token[]): void {
  for (let i = 0; i + 1 < tokens.length; i++) {
    const word = tokens[i];
    const next = tokens[i + 1];
    if (word.adjectiveAfterDeterminer && word.colour !== null && next.colour !== null && !next.isDeterminer &&
      !brokenBetween(text, word, next)) {
      word.colour = null;
    }
  }
}

function isGender(colour: WordColour | null): colour is Gender {
  return colour === 'm' || colour === 'f' || colour === 'n';
}

/** German agreement (Steph's rules): only capitalised words and determiners take part. */
function agreeGerman(tokens: Token[], pack: LanguagePack): void {
  const jobs = tokens.filter(t => t.isDeterminer || t.capitalised);
  for (let i = 0; i < jobs.length; i++) {
    const det = jobs[i];
    if (!det.isDeterminer) {
      continue;
    }
    if (det.relative) {
      // The nearest noun behind it, however long the clause
      for (let k = i - 1; k >= 0; k--) {
        if (jobs[k].isDeterminer) {
          continue;
        }
        if (isGender(jobs[k].colour)) {
          det.colour = jobs[k].colour;
        }
        break;
      }
      continue;
    }
    for (let k = i + 1; k < jobs.length && k <= i + pack.agreementLookahead; k++) {
      const candidate = jobs[k];
      // A new sentence ("... habe eine. Das Kind") or a relative clause starts here
      if (candidate.initial || candidate.relative) {
        break;
      }
      // An article is never followed by another determiner: "ist das der Lorbeer?" - that "das" is a pronoun
      if (candidate.isDeterminer) {
        break;
      }
      if (isGender(candidate.colour)) {
        det.colour = candidate.colour;
      }
      break;
    }
  }
}

/** Article languages: the next noun within the look-ahead, adjectives in between, never across punctuation. */
function agreeForward(text: string, tokens: Token[], pack: LanguagePack): void {
  for (let i = 0; i < tokens.length; i++) {
    const det = tokens[i];
    if (!det.isDeterminer) {
      continue;
    }
    for (let k = i + 1; k < tokens.length && k <= i + pack.agreementLookahead; k++) {
      const candidate = tokens[k];
      if (brokenBetween(text, tokens[k - 1], candidate) || candidate.isDeterminer) {
        break;
      }
      if (candidate.colour !== null) {
        if (isGender(candidate.colour)) {
          det.colour = candidate.colour;
        }
        break;
      }
    }
  }
}

export async function colourLine(text: string, options: LineColouringOptions): Promise<ColouredWord[]> {
  if (!text || !text.trim()) {
    return [];
  }
  const tokens = tokenize(text, options);
  classifyNouns(text, tokens, await lookUpCandidates(tokens, options), options);
  if (options.pack.determinerDecidesHomographs) {
    dropAdjectivesBeforeNouns(text, tokens);
  }

  if (options.articles && options.pack.agreementLookahead > 0) {
    if (options.pack.relativePronouns) {
      agreeGerman(tokens, options.pack);
    } else {
      agreeForward(text, tokens, options.pack);
    }
  }

  return tokens
    .filter(t => t.colour !== null)
    .map(t => ({start: t.start, end: t.end, colour: t.colour!}));
}
