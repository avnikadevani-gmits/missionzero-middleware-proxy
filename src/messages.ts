/**
 * Every sentence the proxy sends for a person to read, in English and Greek.
 *
 * English stays in the fields it has always been in (`warnings`, `dataStatus.notice`,
 * `materialLabel`, `error.message`). Greek is sent alongside under `translations.el`,
 * in the same response, so there is no language parameter and one cached answer
 * serves both. Field names from the payload (purity, dataSource, ...) are kept as
 * they are in both languages: they are identifiers, not prose.
 */
import type { MaterialCode } from './types.js';

export interface Message {
  en: string;
  el: string;
}

export const MATERIAL_LABELS: Record<MaterialCode, Message> = {
  pcb: { en: 'PCB', el: 'PCB' },
  cu: { en: 'Copper', el: 'Χαλκός' },
  al: { en: 'Aluminium', el: 'Αλουμίνιο' },
};

/** Prefixes a per-material sentence with the material's name in each language. */
const forMaterial = (material: MaterialCode, en: string, el: string): Message => ({
  en: `${MATERIAL_LABELS[material].en}: ${en}`,
  el: `${MATERIAL_LABELS[material].el}: ${el}`,
});

export const WARNINGS = {
  runTimeMissing: (): Message => ({
    en: 'The time of the latest run was not published.',
    el: 'Ο χρόνος της τελευταίας εκτέλεσης δεν δημοσιεύτηκε.',
  }),
  notPublished: (m: MaterialCode) =>
    forMaterial(
      m,
      'no result is published for this run.',
      'δεν έχει δημοσιευτεί αποτέλεσμα για αυτή την εκτέλεση.',
    ),
  publishedTwice: (m: MaterialCode) =>
    forMaterial(
      m,
      'the result is published more than once for this run, so none is shown.',
      'το αποτέλεσμα έχει δημοσιευτεί περισσότερες από μία φορές για αυτή την εκτέλεση, επομένως δεν εμφανίζεται κανένα.',
    ),
  rangeNotStated: (m: MaterialCode) =>
    forMaterial(
      m,
      "the result does not say whether it was produced inside the model's fitted range.",
      'το αποτέλεσμα δεν αναφέρει αν παρήχθη εντός του εύρους στο οποίο προσαρμόστηκε το μοντέλο.',
    ),
  unreadable: (m: MaterialCode, reason: Message) =>
    forMaterial(
      m,
      `the published result could not be read (${reason.en}), so it is not shown.`,
      `το δημοσιευμένο αποτέλεσμα δεν ήταν δυνατό να διαβαστεί (${reason.el}), επομένως δεν εμφανίζεται.`,
    ),
  disagreement: (what: Message): Message => ({
    en: `The results of this run do not agree on the ${what.en}; the first is shown.`,
    el: `Τα αποτελέσματα αυτής της εκτέλεσης δεν συμφωνούν ως προς ${what.el}· εμφανίζεται το πρώτο.`,
  }),
};

/** What results can disagree about. Greek carries its article, in the accusative. */
export const SHARED_FIELDS = {
  model: { en: 'model', el: 'το μοντέλο' },
  scenario: { en: 'scenario', el: 'το σενάριο' },
  site: { en: 'site', el: 'την εγκατάσταση' },
} satisfies Record<string, Message>;

/** Why one result could not be read. `field` is the attribute name, kept as is. */
export const REASONS = {
  materialMismatch: (): Message => ({
    en: 'material does not match the entity id',
    el: 'το υλικό δεν αντιστοιχεί στο αναγνωριστικό της οντότητας',
  }),
  noProvenance: (field: string): Message => ({
    en: `no recognised ${field}`,
    el: `δεν υπάρχει αναγνωρίσιμο ${field}`,
  }),
  notANumber: (field: string): Message => ({
    en: `${field} is not a number`,
    el: `το ${field} δεν είναι αριθμός`,
  }),
  outOfBounds: (field: string): Message => ({
    en: `${field} is out of bounds`,
    el: `το ${field} είναι εκτός ορίων`,
  }),
  noDataSource: (field: string): Message => ({
    en: `${field} carries no recognised dataSource`,
    el: `το ${field} δεν φέρει αναγνωρίσιμο dataSource`,
  }),
};

export const NOTICES = {
  none: { en: '', el: '' },
  noResults: {
    en: 'No valid results are published for the latest run.',
    el: 'Δεν έχουν δημοσιευτεί έγκυρα αποτελέσματα για την τελευταία εκτέλεση.',
  },
  simulatedPlaceholder: {
    en: 'Simulated results from a placeholder model. These are not validated production measurements.',
    el: 'Προσομοιωμένα αποτελέσματα από δοκιμαστικό μοντέλο (placeholder). Δεν αποτελούν επικυρωμένες μετρήσεις παραγωγής.',
  },
  simulated: {
    en: 'Simulated results. These are not validated production measurements.',
    el: 'Προσομοιωμένα αποτελέσματα. Δεν αποτελούν επικυρωμένες μετρήσεις παραγωγής.',
  },
  placeholder: {
    en: 'Results from a placeholder model. These are not validated production measurements.',
    el: 'Αποτελέσματα από δοκιμαστικό μοντέλο (placeholder). Δεν αποτελούν επικυρωμένες μετρήσεις παραγωγής.',
  },
  notValidated: {
    en: 'These results are not confirmed as validated production measurements.',
    el: 'Τα αποτελέσματα αυτά δεν έχουν επιβεβαιωθεί ως επικυρωμένες μετρήσεις παραγωγής.',
  },
} satisfies Record<string, Message>;

export const ERRORS = {
  invalidRequest: { en: 'The request is not valid.', el: 'Το αίτημα δεν είναι έγκυρο.' },
  noParameters: {
    en: 'This endpoint takes no parameters.',
    el: 'Αυτό το σημείο πρόσβασης δεν δέχεται παραμέτρους.',
  },
  tooLarge: { en: 'The request is too large.', el: 'Το αίτημα είναι υπερβολικά μεγάλο.' },
  notFound: { en: 'Not found.', el: 'Δεν βρέθηκε.' },
  rateLimited: {
    en: 'Too many requests. Try again shortly.',
    el: 'Πάρα πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.',
  },
  originNotAllowed: { en: 'This origin is not allowed.', el: 'Αυτή η προέλευση δεν επιτρέπεται.' },
  methodNotAllowed: { en: 'Only GET is supported.', el: 'Υποστηρίζεται μόνο η μέθοδος GET.' },
  upstreamTimeout: {
    en: 'The data source did not answer in time.',
    el: 'Η πηγή δεδομένων δεν απάντησε εγκαίρως.',
  },
  upstreamUnavailable: {
    en: 'The data source is unavailable or returned an unusable answer.',
    el: 'Η πηγή δεδομένων δεν είναι διαθέσιμη ή επέστρεψε μη αξιοποιήσιμη απάντηση.',
  },
  previewLocked: {
    en: 'These results are not available through the public preview.',
    el: 'Αυτά τα αποτελέσματα δεν είναι διαθέσιμα μέσω της δημόσιας προεπισκόπησης.',
  },
  internal: { en: 'Something went wrong.', el: 'Κάτι πήγε στραβά.' },
} satisfies Record<string, Message>;
