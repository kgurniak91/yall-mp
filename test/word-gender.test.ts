import * as fs from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {DEFAULT_GENDER_TAG_NAMES, prepareTagNames, readGender, TermsFindResult} from '../src/app/features/project-details/services/word-gender/gender-reader';
import {languagePack} from '../src/app/features/project-details/services/word-gender/language-packs';
import {AmbiguousMode, colourLine} from '../src/app/features/project-details/services/word-gender/line-colouring';

/**
 * Word colouring against what the real bundled Yomitan returned for real wty-* and kty-* dictionaries
 * (test/fixtures/word-gender, recorded by test/e2e/record-word-gender.spec.ts). Expected values are the
 * linguistically right answer; where the dictionary data makes the app wrong, the case says so (KNOWN MISS).
 */
const FIXTURES = path.join(__dirname, 'fixtures', 'word-gender');
const TAGS = prepareTagNames(DEFAULT_GENDER_TAG_NAMES);

interface Fixture {
  dictionary: string;
  language: string;
  lookups: Record<string, TermsFindResult | {error: unknown}>;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

function result(fixture: Fixture, word: string): TermsFindResult | null {
  if (!(word in fixture.lookups)) {
    throw new Error(`"${word}" was not recorded for ${fixture.dictionary}: add it to words.json and record again`);
  }
  const r = fixture.lookups[word];
  return 'error' in r ? null : r;
}

/** '' = not coloured; 'mf' etc. = a noun with both genders. */
function genderOf(fixture: Fixture, word: string): string {
  return readGender(result(fixture, word), word, TAGS)?.genders.join('') ?? '';
}

/**
 * Renders a coloured line as text: "[Weisheit]f ist ein [Segen]m". Words without colour stay bare.
 */
async function colouredLine(fixture: Fixture, text: string, opts: {articles?: boolean; ambiguous?: AmbiguousMode} = {}): Promise<string> {
  const words = await colourLine(text, {
    language: fixture.language,
    pack: languagePack(fixture.language),
    tags: TAGS,
    articles: opts.articles ?? true,
    ambiguous: opts.ambiguous ?? 'mark',
    lookup: async word => result(fixture, word)
  });
  let out = '';
  let at = 0;
  for (const w of words) {
    out += text.slice(at, w.start) + `[${text.slice(w.start, w.end)}]${w.colour}`;
    at = w.end;
  }
  return out + text.slice(at);
}

type WordTable = Record<string, string>;

/** Expected for the wty dictionary; `kty` lists only where kty differs. */
const WORDS: Record<string, {wty: WordTable; kty?: WordTable}> = {
  de: {
    wty: {
      Pferd: 'n', Weisheit: 'f', Segen: 'm', Fluch: 'm', Mann: 'm', Frau: 'f', Kind: 'n', Mädchen: 'n', Haus: 'n',
      // form-of entries without their own gender: Yomitan returns the lemma
      Häuser: 'n', Kindern: 'n', Männer: 'm', Frauen: 'f', Hauses: 'n', Lüfte: 'f', Menschen: 'm',
      Umhang: 'm', Mannschaft: 'f', Welt: 'f', Lorbeer: 'm', Zeit: 'f', Tür: 'f', Saft: 'm', Essen: 'n', Leben: 'n',
      // a lower meaning with another gender does not count: der Mittag (das Mittag is informal), der See first
      Mittag: 'm', See: 'm', Teil: 'm',
      // the word on its own is the noun die Hast; the sentence rule drops it at the start of "Hast du Zeit?"
      Hast: 'f',
      hast: '', Wir: '', wir: '', Sag: '', Meine: '', Grobi: '',
      // articles never take their own dictionary gender
      Die: '', die: '', der: '', das: '', einen: ''
    },
    // kty merges the tags of all senses into one: Mann gets masc AND neut
    kty: {Mann: 'mn', Männer: 'mn'}
  },
  fr: {
    wty: {
      maison: 'f', maisons: 'f', livre: 'm', porte: 'f', cheval: 'm', chevaux: 'm', eau: 'f', homme: 'm', femmes: 'f',
      yeux: 'm', problème: 'm', mer: 'f', travail: 'm', travaux: 'm', voiture: 'f', chiens: 'm',
      // m or f by sense
      artiste: 'mf', élève: 'mf',
      la: '', le: '', les: '', est: '', mange: '', parle: '',
      // a proper noun ranks first for the capitalised spelling; the line looks up "maison" at a sentence start
      Maison: ''
    }
  },
  es: {
    wty: {
      casa: 'f', libro: 'm', vino: 'm', agua: 'f', mano: 'f', manos: 'f', problema: 'm', perro: 'm', perros: 'm',
      mar: 'm', día: 'm', ciudades: 'f', leche: 'f', niña: 'f', Casa: 'f',
      // listed as the "plural masculine" of niña: the rule chain names the form's own gender
      niños: 'm',
      // the verb casar ranks first; after an article the noun is read ("las casas", see the lines)
      casas: '',
      // the noun "el habla" ranks first; the line rule leaves it plain when no article comes before
      habla: 'f',
      el: '', la: '', es: '', como: ''
    },
    // kty puts both genders on one meaning (el mar, poetic la mar)
    kty: {mar: 'mf'}
  },
  it: {
    wty: {
      casa: 'f', case: 'f', libro: 'm', uomo: 'm', uomini: 'm', porta: 'f', mano: 'f', problema: 'm', città: 'f',
      ragazzi: 'm', ragazza: 'f',
      // KNOWN MISS: the rare lemma "mani" (masculine) ranks above the plural of "mano"
      mani: 'm',
      il: '', la: '', è: '', mangia: '', parla: ''
    },
    // kty ranks the noun "il mangiare" above the verb; in a line the verb reading with no article leaves it plain
    kty: {mangia: 'm'}
  },
  ru: {
    wty: {
      дом: 'm', книга: 'f', книги: 'f', книгу: 'f', окно: 'n', окна: 'n', кошкой: 'f', путь: 'm', люди: 'm',
      людей: 'm', девочка: 'f', мальчики: 'm', время: 'n', времени: 'n', мать: 'f', папа: 'm', собаку: 'f', Дом: 'm',
      // кофе is masculine, neuter in colloquial use
      кофе: 'mn',
      // "at home" ranks first
      дома: '',
      это: '', читает: '', он: '', она: ''
    }
  },
  pl: {
    wty: {
      dom: 'm', domu: 'm', książka: 'f', książki: 'f', książkę: 'f', okno: 'n', kot: 'm', kota: 'm',
      mężczyzna: 'm', ludzie: 'm', kobieta: 'f', kobiety: 'f', dziecko: 'n', oczy: 'n', rękę: 'f',
      mieszkanie: 'n', psa: 'm', Dom: 'm',
      // KNOWN MISS: the interjection "dzieci!" ranks above the plural of dziecko
      dzieci: '',
      jest: '', czyta: '', on: '', ona: ''
    },
    // kty ranks the plural of dziecko first
    kty: {dzieci: 'n'}
  }
};

for (const [language, tables] of Object.entries(WORDS)) {
  for (const family of ['wty', 'kty'] as const) {
    const name = `${family}-${language}-en`;
    if (!fs.existsSync(path.join(FIXTURES, `${name}.json`))) {
      continue;
    }
    describe(`word gender, ${name}`, () => {
      const fixture = loadFixture(name);
      const expected = {...tables.wty, ...(family === 'kty' ? tables.kty : {})};
      for (const [word, gender] of Object.entries(expected)) {
        it(`${word} -> ${gender || 'plain'}`, () => {
          expect(genderOf(fixture, word)).toBe(gender);
        });
      }
    });
  }
}

/** Whole lines, wty dictionaries. */
const LINES: Record<string, Array<[string, string]>> = {
  de: [
    // Steph's screenshot
    ['Meine Weisheit ist sowohl ein Segen als auch ein Fluch.', '[Meine]f [Weisheit]f ist sowohl [ein]m [Segen]m als auch [ein]m [Fluch]m.'],
    ['Grobi, Elin, Ebby, Wolle, Samson, Pferd', 'Grobi, Elin, Ebby, [Wolle]f, Samson, [Pferd]n'],
    // agreement across an adjective; the article takes the noun's colour whatever its case
    ['Ich trinke einen kalten Saft.', 'Ich trinke [einen]m kalten [Saft]m.'],
    ['Er fliegt mit einem Umhang durch die Lüfte.', 'Er fliegt mit [einem]m [Umhang]m durch [die]f [Lüfte]f.'],
    ['Das Kind spielt mit den Kindern.', '[Das]n [Kind]n spielt mit [den]n [Kindern]n.'],
    // a relative pronoun points back to the noun before the comma
    ['Die Welt, in der die Menschen leben.', '[Die]f [Welt]f, in [der]f [die]m [Menschen]m leben.'],
    // "das der": that "das" is a pronoun, not an article
    ['Sag mal, ist das der Lorbeer?', 'Sag mal, ist das [der]m [Lorbeer]m?'],
    // sentence-initial capital: "hast" is a verb
    ['Hast du Zeit?', 'Hast du [Zeit]f?'],
    // an article with no noun after it stays plain; the next sentence starts fresh
    ['Ich habe eine. Das Kind lacht.', 'Ich habe eine. [Das]n [Kind]n lacht.'],
    // KNOWN MISS (Steph's own note): the relative pronoun refers to Tür, the nearest noun is Hauses
    ['Die Tür des Hauses, die offen war.', '[Die]f [Tür]f [des]n [Hauses]n, [die]n offen war.']
  ],
  fr: [
    ['La porte de la maison est ouverte.', '[La]f [porte]f de [la]f [maison]f est ouverte.'],
    // no article: "porte" is the verb
    ['Il porte un livre.', 'Il porte [un]m [livre]m.'],
    // elision
    ["L'eau et l'homme.", "[L']f[eau]f et [l']m[homme]m."],
    ['Les chevaux mangent dans la grande prairie.', '[Les]m [chevaux]m mangent dans [la]f grande [prairie]f.'],
    // two genders: marked, the article stays plain
    ["Je parle avec l'artiste.", "Je parle avec l'[artiste]x."],
    ["C'est une belle voiture.", "C'est [une]f belle [voiture]f."]
  ],
  es: [
    // after an article the noun reading wins over the verb casar
    ['Las casas son grandes.', '[Las]f [casas]f son grandes.'],
    ['El agua está fría.', '[El]f [agua]f está fría.'],
    // no article: "habla" is the verb
    ['Él habla con la niña.', 'Él habla con [la]f [niña]f.'],
    ['Los perros comen en el jardín.', '[Los]m [perros]m comen en [el]m [jardín]m.'],
    ['Tengo un problema con mi mano.', 'Tengo [un]m [problema]m con [mi]f [mano]f.']
  ],
  it: [
    ["La casa dell'uomo è grande.", "[La]f [casa]f [dell']m[uomo]m è grande."],
    ['Il ragazzo porta un libro.', '[Il]m [ragazzo]m porta [un]m [libro]m.'],
    ['Gli uomini parlano nella città.', '[Gli]m [uomini]m parlano [nella]f [città]f.'],
    // KNOWN MISS: "mani" (see the word table)
    ['Le mani della ragazza.', '[Le]m [mani]m [della]f [ragazza]f.']
  ],
  pt: [
    ['A casa é grande.', '[A]f [casa]f é grande.'],
    ['O menino come o pão.', '[O]m [menino]m come [o]m [pão]m.'],
    ['As mulheres falam com os homens.', '[As]f [mulheres]f falam com [os]m [homens]m.'],
    ['Ele abre a porta da cidade.', 'Ele abre [a]f [porta]f [da]f [cidade]f.']
  ],
  ru: [
    // "дома" here is "at home" (and ranks so)
    ['Девочка читает книгу дома.', '[Девочка]f читает [книгу]f дома.'],
    ['Мальчики видят собаку.', '[Мальчики]m видят [собаку]f.'],
    ['У меня нет времени.', 'У меня нет [времени]n.'],
    ['Это мой дом.', 'Это мой [дом]m.']
  ],
  pl: [
    ['Kobieta czyta książkę w domu.', '[Kobieta]f czyta [książkę]f w [domu]m.'],
    // KNOWN MISS: "dzieci" (see the word table)
    ['Dzieci mają psa.', 'Dzieci mają [psa]m.'],
    ['To jest moje mieszkanie.', 'To jest moje [mieszkanie]n.'],
    ['Mężczyzna widzi kota.', '[Mężczyzna]m widzi [kota]m.']
  ]
};

for (const [language, lines] of Object.entries(LINES)) {
  const name = `wty-${language}-en`;
  if (!fs.existsSync(path.join(FIXTURES, `${name}.json`))) {
    continue;
  }
  describe(`coloured lines, ${name}`, () => {
    const fixture = loadFixture(name);
    for (const [text, expected] of lines) {
      it(text, async () => {
        expect(await colouredLine(fixture, text)).toBe(expected);
      });
    }
  });
}

describe('coloured lines, options', () => {
  it('articles off: only the nouns', async () => {
    const fixture = loadFixture('wty-de-en');
    expect(await colouredLine(fixture, 'Ich trinke einen kalten Saft.', {articles: false})).toBe('Ich trinke einen kalten [Saft]m.');
  });

  it('two genders: first, mark or skip', async () => {
    const fixture = loadFixture('wty-fr-en');
    const line = "Je parle avec l'artiste.";
    expect(await colouredLine(fixture, line, {ambiguous: 'first'})).toBe("Je parle avec [l']m[artiste]m.");
    expect(await colouredLine(fixture, line, {ambiguous: 'skip'})).toBe("Je parle avec l'artiste.");
  });

  it('custom tag names: a dictionary that spells genders differently', async () => {
    const custom = prepareTagNames({masculine: ['m'], feminine: ['f'], neuter: ['nt'], noun: ['noun']});
    const response: TermsFindResult = {
      originalTextLength: 4,
      dictionaryEntries: [{headwords: [{term: 'Haus'}], definitions: [{tags: [{name: 'noun', category: 'partOfSpeech'}, {name: 'nt'}]}]}]
    };
    expect(readGender(response, 'Haus', custom)?.genders).toEqual(['n']);
    expect(readGender(response, 'Haus', TAGS)).toBeNull();
  });

  it('a part-of-speech "n" is never read as neuter, even when neuter is configured as "n"', () => {
    const custom = prepareTagNames({masculine: ['masc'], feminine: ['fem'], neuter: ['n'], noun: ['n']});
    const response: TermsFindResult = {
      originalTextLength: 4,
      dictionaryEntries: [{definitions: [{tags: [{name: 'n', category: 'partOfSpeech'}, {name: 'fem', category: 'gender-feminine'}]}]}]
    };
    expect(readGender(response, 'Welt', custom)?.genders).toEqual(['f']);
  });

  it('a partial match is not the word ("Mannschaft" is not "Mann")', () => {
    const response: TermsFindResult = {
      originalTextLength: 4,
      dictionaryEntries: [{definitions: [{tags: [{name: 'n', category: 'partOfSpeech'}, {name: 'masc'}]}]}]
    };
    expect(readGender(response, 'Mannschaft', TAGS)).toBeNull();
  });
});
