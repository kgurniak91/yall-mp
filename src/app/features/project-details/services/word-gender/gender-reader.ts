/**
 * Reads the grammatical gender of a word from one Yomitan `termsFind` result. Pure: no Angular, no DOM, so the
 * Vitest suite runs it against responses recorded from real dictionaries (test/fixtures/word-gender).
 *
 * Built on the approach of Steph's (GitHub: @stephdolgo) gender-german.js for Y'ALL MP (tags read by name, part-of-speech tags
 * skipped, partial matches rejected, the top-ranked meaning decides) and checked against wty-* and kty-*
 * dictionaries in seven languages (test/word-gender.test.ts).
 */

export interface YomitanTag {
  name: string;
  category?: string;
}

export interface YomitanDefinition {
  dictionary?: string;
  tags?: YomitanTag[];
}

export interface YomitanHeadword {
  term: string;
  tags?: YomitanTag[];
}

/** How Yomitan got from the looked-up form to the entry: its own deinflector ('algorithm') or a form-of entry of the dictionary. */
export interface YomitanRuleChain {
  source?: string;
  inflectionRules?: Array<{name?: string} | string>;
}

export interface YomitanEntry {
  headwords?: YomitanHeadword[];
  definitions?: YomitanDefinition[];
  inflectionRuleChainCandidates?: YomitanRuleChain[];
}

/** The `result` of a Yomitan `termsFind` call (the parts this module reads). */
export interface TermsFindResult {
  originalTextLength?: number;
  dictionaryEntries?: YomitanEntry[];
}

export type Gender = 'm' | 'f' | 'n';

/** One gender, or several (a noun that is really two-gendered, e.g. French "artiste"), or null: not a gendered noun. */
export type GenderVerdict = {genders: Gender[]} | null;

/** Tag names, as the dictionaries spell them. Matched exactly, ignoring case. */
export interface GenderTagNames {
  masculine: string[];
  feminine: string[];
  neuter: string[];
  noun: string[];
}

export const DEFAULT_GENDER_TAG_NAMES: GenderTagNames = {
  masculine: ['masc'],
  feminine: ['fem'],
  neuter: ['neut'],
  noun: ['n']
};

/**
 * 'top': only the top-ranked entry counts (the usual case: "porte" is read as the noun it ranks as).
 * 'firstNoun': the first of the top entries whose first meaning is a noun; used right after an article, where the
 * word must be a noun ("las casas", although Yomitan ranks the verb "casar" first).
 */
export type ReadMode = 'top' | 'firstNoun';

const FIRST_NOUN_SEARCH_DEPTH = 3;
const PART_OF_SPEECH = 'partofspeech';
/** Part-of-speech names of verbs and adjectives in wty-* and kty-* dictionaries. */
const VERB_TAGS = new Set(['v', 'vt', 'vi', 'vr', 'vp', 'aux']);
const ADJECTIVE_TAGS = new Set(['adj']);

function names(list: string[]): Set<string> {
  return new Set(list.map(n => n.trim().toLowerCase()).filter(n => n.length > 0));
}

/** Tag names prepared once per settings change. */
export interface PreparedTagNames {
  masculine: Set<string>;
  feminine: Set<string>;
  neuter: Set<string>;
  noun: Set<string>;
}

export function prepareTagNames(tags: GenderTagNames): PreparedTagNames {
  return {
    masculine: names(tags.masculine),
    feminine: names(tags.feminine),
    neuter: names(tags.neuter),
    noun: names(tags.noun)
  };
}

function tagName(tag: YomitanTag): string {
  return String(tag?.name ?? '').toLowerCase();
}

function isPartOfSpeech(tag: YomitanTag): boolean {
  return String(tag?.category ?? '').toLowerCase() === PART_OF_SPEECH;
}

function isNounDefinition(def: YomitanDefinition | undefined, tags: PreparedTagNames): boolean {
  return (def?.tags ?? []).some(t => tags.noun.has(tagName(t)));
}

function isVerbDefinition(def: YomitanDefinition | undefined): boolean {
  return (def?.tags ?? []).some(t => isPartOfSpeech(t) && VERB_TAGS.has(tagName(t)));
}

function isAdjectiveDefinition(def: YomitanDefinition | undefined): boolean {
  return (def?.tags ?? []).some(t => isPartOfSpeech(t) && ADJECTIVE_TAGS.has(tagName(t)));
}

function gendersOf(tagList: YomitanTag[] | undefined, tags: PreparedTagNames): Gender[] {
  const out: Gender[] = [];
  for (const tag of tagList ?? []) {
    // The noun tag is literally "n": a user who sets neuter to "n" must not make every noun neuter
    if (isPartOfSpeech(tag)) {
      continue;
    }
    const name = tagName(tag);
    const gender: Gender | null = tags.masculine.has(name) ? 'm' : tags.feminine.has(name) ? 'f' : tags.neuter.has(name) ? 'n' : null;
    if (gender && !out.includes(gender)) {
      out.push(gender);
    }
  }
  // Tag order means nothing (Yomitan sorts tags by the dictionary's tag bank): always m, f, n
  return (['m', 'f', 'n'] as Gender[]).filter(g => out.includes(g));
}

/** True when the entry's first (top-ranked) meaning is a noun. */
export function entryIsNoun(entry: YomitanEntry | undefined, tags: PreparedTagNames): boolean {
  return isNounDefinition(entry?.definitions?.[0], tags);
}

/** True when one of the top entries reads the word as a verb (a noun/verb homograph such as "porte", "habla"). */
export function hasVerbReading(result: TermsFindResult | null | undefined): boolean {
  return (result?.dictionaryEntries ?? []).slice(0, FIRST_NOUN_SEARCH_DEPTH).some(e => isVerbDefinition(e.definitions?.[0]));
}

/** True when one of the top entries reads the word as an adjective ("belle": the noun "a beauty", or the adjective "beau"). */
export function hasAdjectiveReading(result: TermsFindResult | null | undefined): boolean {
  return (result?.dictionaryEntries ?? []).slice(0, FIRST_NOUN_SEARCH_DEPTH)
    .some(e => (e.definitions ?? []).some(isAdjectiveDefinition));
}

/** True when the whole word was matched (not just a prefix of it: "Mannschaft" is not "Mann"). */
export function matchesWholeWord(result: TermsFindResult | null | undefined, word: string): boolean {
  if (!result || !(result.dictionaryEntries?.length)) {
    return false;
  }
  const matched = typeof result.originalTextLength === 'number' ? result.originalTextLength : word.length;
  return matched >= word.length;
}

const RULE_GENDERS: Array<[RegExp, Gender]> = [[/\bmasculine\b/i, 'm'], [/\bfeminine\b/i, 'f'], [/\bneuter\b/i, 'n']];

/**
 * The gender a form-of rule names for the form itself. Spanish "niños" is listed as the "plural masculine" of "niña",
 * so Yomitan returns the entry "niña" (feminine) for it; the rule says the word read is masculine. Only one gender
 * across all the chains counts; none or several: the entry's own gender stands.
 */
function ruleChainGender(entry: YomitanEntry): Gender | null {
  const found = new Set<Gender>();
  for (const chain of entry.inflectionRuleChainCandidates ?? []) {
    for (const rule of chain.inflectionRules ?? []) {
      const name = typeof rule === 'string' ? rule : rule?.name ?? '';
      for (const [pattern, gender] of RULE_GENDERS) {
        if (pattern.test(name)) {
          found.add(gender);
        }
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export function readGender(result: TermsFindResult | null | undefined, word: string, tags: PreparedTagNames, mode: ReadMode = 'top'): GenderVerdict {
  if (!matchesWholeWord(result, word)) {
    return null;
  }
  const entries = result!.dictionaryEntries!;
  const entry = mode === 'top'
    ? entries[0]
    : entries.slice(0, FIRST_NOUN_SEARCH_DEPTH).find(e => entryIsNoun(e, tags));
  if (!entry || !entryIsNoun(entry, tags)) {
    return null;
  }
  const fromRules = ruleChainGender(entry);
  if (fromRules) {
    return {genders: [fromRules]};
  }

  // The first meaning decides: a lower one with another gender ("der See" / "die See", "Mittag" also neuter in
  // informal use) does not make the word ambiguous. Only a meaning that carries two genders itself does.
  for (const def of entry.definitions ?? []) {
    if (!isNounDefinition(def, tags)) {
      continue;
    }
    const genders = gendersOf(def.tags, tags);
    if (genders.length > 0) {
      return {genders};
    }
  }
  // Some dictionaries hang the gender on the headword instead
  for (const headword of entry.headwords ?? []) {
    const genders = gendersOf(headword.tags, tags);
    if (genders.length > 0) {
      return {genders};
    }
  }
  return null;
}
