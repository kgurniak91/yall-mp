/**
 * Per-language rules on top of the generic gender reader. The gender always comes from the dictionary; a pack only
 * decides which words are looked up, which words are articles/determiners (coloured by agreement with their noun,
 * never by their own dictionary entry), and a few sentence rules.
 */

export interface LanguagePack {
  /** German: every noun is capitalised, so only capitalised words (and determiners) are looked up. */
  capitalisedNounsOnly: boolean;
  /** Articles and determiners, lowercase. Coloured like the noun they belong to. */
  determiners: ReadonlySet<string>;
  /** French/Italian elisions, lowercase with a straight apostrophe ("l'"): "l'eau" is read as "l'" + "eau". */
  elisions: ReadonlySet<string>;
  /**
   * After a determiner the next word is read as a noun even when a verb ranks first ("las casas"); elsewhere a
   * noun/verb homograph stays plain ("il porte", "él habla"). Off for German (the capital letter already tells).
   */
  determinerDecidesHomographs: boolean;
  /** German relative pronouns ("die Welt, in der ...") take the colour of the noun before the comma. */
  relativePronouns?: {forms: ReadonlySet<string>; prepositions: ReadonlySet<string>};
  /** How many words ahead a determiner looks for its noun. */
  agreementLookahead: number;
}

const set = (words: string): ReadonlySet<string> => new Set(words.split(/\s+/).filter(Boolean));

const GENERIC: LanguagePack = {
  capitalisedNounsOnly: false,
  determiners: new Set(),
  elisions: new Set(),
  determinerDecidesHomographs: false,
  agreementLookahead: 0
};

/**
 * Steph's German lists. Bare "sein" (also "to be") and bare "ihr" (also "you", plural) are left out on purpose;
 * their inflected forms are unambiguous.
 */
const GERMAN: LanguagePack = {
  capitalisedNounsOnly: true,
  determiners: set(`
    der die das den dem des
    ein eine einen einem einer eines
    kein keine keinen keinem keiner keines
    dieser diese dieses diesen diesem
    jeder jede jedes jeden jedem
    welcher welche welches welchen welchem
    mein meine meinen meinem meiner meines
    dein deine deinen deinem deiner deines
    seine seinen seinem seiner seines
    ihre ihren ihrem ihrer ihres
    unser unsere unseren unserem unserer unseres
    euer eure euren eurem eurer eures`),
  elisions: new Set(),
  determinerDecidesHomographs: false,
  relativePronouns: {
    forms: set('der die das den dem deren dessen denen welcher welche welches welchen welchem'),
    prepositions: set('an auf aus bei durch für gegen hinter in mit nach neben ohne seit statt trotz über um unter von vor während wegen zu zwischen')
  },
  agreementLookahead: 3
};

const FRENCH: LanguagePack = {
  capitalisedNounsOnly: false,
  determiners: set(`
    le la l' les un une des du au aux
    ce cet cette ces
    mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs
    quel quelle quels quelles chaque`),
  elisions: set(`l' d' j' m' t' s' n' c' qu' jusqu' lorsqu' puisqu' quoiqu'`),
  determinerDecidesHomographs: true,
  agreementLookahead: 3
};

const SPANISH: LanguagePack = {
  capitalisedNounsOnly: false,
  determiners: set(`
    el la los las un una unos unas al del
    este esta estos estas ese esa esos esas aquel aquella aquellos aquellas
    mi mis tu tus su sus nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras`),
  elisions: new Set(),
  determinerDecidesHomographs: true,
  agreementLookahead: 3
};

const ITALIAN: LanguagePack = {
  capitalisedNounsOnly: false,
  determiners: set(`
    il lo la l' i gli le un uno una un'
    del dello della dell' dei degli delle
    al allo alla all' ai agli alle
    dal dallo dalla dall' dai dagli dalle
    nel nello nella nell' nei negli nelle
    sul sullo sulla sull' sui sugli sulle
    questo questa questi queste quest' quel quello quella quell' quei quegli quelle
    mio mia miei mie tuo tua tuoi tue suo sua suoi sue nostro nostra nostri nostre vostro vostra vostri vostre`),
  elisions: set(`l' un' dell' all' dall' nell' sull' quest' quell' d' c' s' m' t' v' n'`),
  determinerDecidesHomographs: true,
  agreementLookahead: 3
};

const PORTUGUESE: LanguagePack = {
  capitalisedNounsOnly: false,
  determiners: set(`
    o a os as um uma uns umas
    do da dos das no na nos nas ao à aos às pelo pela pelos pelas
    num numa nuns numas dum duma
    este esta estes estas esse essa esses essas aquele aquela aqueles aquelas
    meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas vosso vossa vossos vossas`),
  elisions: new Set(),
  determinerDecidesHomographs: true,
  agreementLookahead: 3
};

const PACKS: Record<string, LanguagePack> = {
  de: GERMAN,
  fr: FRENCH,
  es: SPANISH,
  it: ITALIAN,
  pt: PORTUGUESE
};

/** The pack of a subtitle language (Yomitan ISO code); other languages colour nouns only. */
export function languagePack(language: string | null | undefined): LanguagePack {
  return PACKS[(language ?? '').toLowerCase()] ?? GENERIC;
}

/** Languages with their own rules (articles etc.); every other language with gender tags gets nouns only. */
export const LANGUAGES_WITH_RULES = Object.keys(PACKS);
