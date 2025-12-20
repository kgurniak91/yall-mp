/**
 * Key: ISO 639-3 (franc-all output / Legacy App Data)
 * Value: ISO 639-1 (Yomitan internal code)
 */
export const LEGACY_TO_YOMITAN_ISO_MAP: Record<string, string> = {
  // --- Chinese Family ---
  'cmn': 'zh', // Mandarin (franc default)
  'zho': 'zh', // Chinese Macro
  'och': 'zh', // Old Chinese
  'lzh': 'zh', // Literary Chinese
  'nan': 'zh', // Min Nan (optional)

  // --- Norwegian Family ---
  'nor': 'no', // Macro
  'nob': 'no', // Norwegian Bokmål (franc default)
  'nno': 'no', // Norwegian Nynorsk

  // --- Serbo-Croatian Family ---
  'hbs': 'sh', // Macro
  'srp': 'sh', // Serbian (franc default)
  'hrv': 'sh', // Croatian (franc default)
  'bos': 'sh', // Bosnian (franc default)

  // --- Persian Family ---
  'fas': 'fa', // Macro
  'pes': 'fa', // Western Persian (franc default)

  // --- Standard Mappings (Yomitan 639-3 -> Yomitan ISO) ---
  'aii': 'aii', // Assyrian Neo-Aramaic
  'ara': 'ar',
  'arz': 'arz',
  'bul': 'bg',
  'ces': 'cs',
  'dan': 'da',
  'deu': 'de',
  'ell': 'el',  // Modern Greek
  'eng': 'en',
  'epo': 'eo',
  'spa': 'es',
  'est': 'et',
  'fin': 'fi',
  'fra': 'fr',
  'gle': 'ga',
  'grc': 'grc', // Ancient Greek
  'haw': 'haw',
  'heb': 'he',
  'hin': 'hi',
  'hun': 'hu',
  'ind': 'id',
  'ita': 'it',
  'lat': 'la',
  'lao': 'lo',
  'lav': 'lv',
  'kat': 'ka',
  'kan': 'kn',
  'khm': 'km',
  'kor': 'ko',
  'mon': 'mn',
  'mlt': 'mt',
  'nld': 'nl',
  'pol': 'pl',
  'por': 'pt',
  'ron': 'ro',
  'rus': 'ru',
  'sga': 'sga',
  'sqi': 'sq',
  'swe': 'sv',
  'tgl': 'tl',
  'tha': 'th',
  'tur': 'tr',
  'tok': 'tok',
  'ukr': 'uk',
  'vie': 'vi',
  'cym': 'cy',
  'yid': 'yi',
  'yue': 'yue',

  // --- Special Yomitan Cases ---
  'jpn': 'ja',
};

export function normalizeLanguageCode(code: string): string {
  // franc-all returns 'und' for undetermined
  if (!code || code === 'other' || code === 'und') {
    return 'other';
  }

  // Check if it's already a valid Yomitan 2-char code or special code
  if (code.length === 2) {
    return code;
  }

  // Map ISO 639-3 to Yomitan code
  const mapped = LEGACY_TO_YOMITAN_ISO_MAP[code];
  if (mapped) {
    return mapped;
  }

  // Fallback
  return 'other';
}
