/**
 * Turns AnkiConnect's terse addNote errors into a message that says what went
 * wrong and what to change. Pure functions; electron-main.ts gathers the note
 * type's fields and card templates from AnkiConnect when a message needs them.
 */

export interface AnkiTemplateSides {
  Front: string;
  Back: string;
}

export interface AddNoteErrorContext {
  templateName: string;
  deckName: string;
  modelName: string;
  /** The fields Y'ALL MP sent: field name -> value. */
  fields: Record<string, string>;
  /** Field names of the note type, in order (AnkiConnect modelFieldNames), when known. */
  modelFieldNames?: string[] | null;
  /** Card templates of the note type (AnkiConnect modelTemplates), when known. */
  cardTemplates?: Record<string, AnkiTemplateSides> | null;
}

/** Message shown when Anki itself cannot be reached. */
export const ANKI_UNREACHABLE_MESSAGE =
  'Could not reach Anki at http://localhost:8765. Check that Anki is open and that the AnkiConnect add-on is installed.';

/** Fields that card templates show as clozes: `{{cloze:Text}}`, `{{type:cloze:Text}}`, `{{cloze:furigana:Text}}` … */
export function clozeFieldNames(cardTemplates: Record<string, AnkiTemplateSides> | null | undefined): string[] {
  const names = new Set<string>();
  for (const sides of Object.values(cardTemplates ?? {})) {
    for (const html of [sides?.Front ?? '', sides?.Back ?? '']) {
      for (const match of html.matchAll(/\{\{([^{}]*?)\}\}/g)) {
        const parts = match[1].split(':').map(part => part.trim());
        if (parts.length >= 2 && parts.slice(0, -1).includes('cloze')) {
          names.add(parts[parts.length - 1]);
        }
      }
    }
  }
  return [...names];
}

/** True when the text contains an Anki cloze deletion such as `{{c1::word}}`. */
export function containsCloze(text: string | null | undefined): boolean {
  return /\{\{c\d+::/.test(text ?? '');
}

/** The note's text without tags, for "is this field empty" checks. */
function isBlank(value: string | undefined): boolean {
  return (value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

/**
 * Plain-text explanation of a failed addNote. The first line is the cause;
 * the last line quotes Anki's own words.
 */
export function explainAddNoteError(ankiMessage: string, context: AddNoteErrorContext): string {
  const {templateName, deckName, modelName, fields} = context;
  const lower = (ankiMessage || '').toLowerCase();
  const where = `Export template "${templateName}" (deck "${deckName}", note type "${modelName}")`;
  const lines: string[] = [];

  if (lower.includes('model was not found') || lower.includes('model not found')) {
    lines.push(`${where}: Anki has no note type called "${modelName}". It may have been renamed or deleted. Choose a note type again in Global settings → Anki.`);
  } else if (lower.includes('deck was not found') || lower.includes('deck not found')) {
    lines.push(`${where}: Anki has no deck called "${deckName}". It may have been renamed or deleted. Choose a deck again in Global settings → Anki.`);
  } else if (lower.includes('because it is empty')) {
    const firstField = context.modelFieldNames?.[0];
    lines.push(firstField
      ? `${where}: the first field of the note type, "${firstField}", would be empty, and Anki does not create notes with an empty first field. Map a source (for example the subtitle text) to "${firstField}" in the export template.`
      : `${where}: the first field of the note type would be empty, and Anki does not create notes with an empty first field. Map a source to it in the export template.`);
  } else if (lower.includes('unknown reason')) {
    const clozeFields = clozeFieldNames(context.cardTemplates);
    const clozeFieldsWithoutCloze = clozeFields.filter(name => !containsCloze(fields[name]));
    if (clozeFields.length > 0 && clozeFieldsWithoutCloze.length === clozeFields.length) {
      const names = clozeFields.map(name => `"${name}"`).join(' or ');
      const sentFields = clozeFields.filter(name => name in fields);
      const what = sentFields.length > 0
        ? `the text Y'ALL MP sends to ${sentFields.map(name => `"${name}"`).join(' and ')} has none`
        : `the export template does not fill ${names}`;
      lines.push(`${where}: this is a cloze note type, and Anki only creates a cloze note when ${names} contains a cloze such as {{c1::…}}; ${what}. Y'ALL MP does not write clozes, so choose a note type without clozes for this export template in Global settings → Anki.`);
    } else {
      const emptyFront = frontFieldNames(context.cardTemplates).filter(name => isBlank(fields[name]));
      lines.push(emptyFront.length > 0
        ? `${where}: Anki refused the note without naming a reason. The card's front uses ${emptyFront.map(name => `"${name}"`).join(', ')}, which the export leaves empty, so Anki would create no card. Map a source to one of them in the export template.`
        : `${where}: Anki refused the note without naming a reason. Check the note type's card templates in Anki (Tools → Manage Note Types → Cards): a note is refused when it would produce no card.`);
    }
  } else if (lower.includes('duplicate')) {
    lines.push(`${where}: Anki refused the note as a duplicate of an existing note.`);
  } else if (ankiMessage === ANKI_UNREACHABLE_MESSAGE) {
    lines.push(ankiMessage);
    return lines.join('\n');
  } else {
    lines.push(`${where}: Anki refused the note.`);
  }

  lines.push(`Anki said: "${ankiMessage}"`);
  return lines.join('\n');
}

/** Field names used on the front side of any card template (`{{Field}}`, `{{#Field}}`, `{{text:Field}}` …). */
function frontFieldNames(cardTemplates: Record<string, AnkiTemplateSides> | null | undefined): string[] {
  const names = new Set<string>();
  for (const sides of Object.values(cardTemplates ?? {})) {
    for (const match of (sides?.Front ?? '').matchAll(/\{\{([#^/]?)([^{}]*?)\}\}/g)) {
      const name = match[2].split(':').pop()!.trim();
      if (name && name !== 'FrontSide' && !['Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag'].includes(name)) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** Escapes text for the toast, which renders its detail as HTML; newlines become <br>. */
export function toToastHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
