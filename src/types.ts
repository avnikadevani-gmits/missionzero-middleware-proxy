/** The public response contract of GET /api/digital-twin/latest. */

/** Material codes as the twin writes them. Their names are in messages.ts. */
export const MATERIAL_CODES = ['pcb', 'cu', 'al'] as const;
export type MaterialCode = (typeof MATERIAL_CODES)[number];

/** Where a value came from. The twin's closed vocabulary. */
export const DATA_SOURCES = ['measured', 'simulated', 'fallback', 'manual', 'unavailable'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/** How the model came to exist. A different axis from DataSource. */
export const MODEL_PROVENANCES = ['fitted', 'vendor', 'placeholder', 'unstated'] as const;
export type ModelProvenance = (typeof MODEL_PROVENANCES)[number];

export interface Figure {
  value: number;
  /** UN/CEFACT code, e.g. P1 (percent), SEC (second). Null if the twin sent none. */
  unitCode: string | null;
  dataSource: DataSource;
}

export interface MaterialResult {
  entityId: string;
  material: MaterialCode;
  materialLabel: string;
  /** Null means the twin did not publish this figure. It is never defaulted. */
  recoveryRate: Figure | null;
  purity: Figure | null;
  cycleTime: Figure | null;
  massRecovered: Figure | null;
  dataProvenance: DataSource;
  modelProvenance: ModelProvenance;
  modelId: string | null;
  modelVersion: string | null;
  /** Null means the twin did not say. Null is not "in range". */
  inValidatedRange: boolean | null;
  outOfRangeReason: string | null;
}

export interface LatestRun {
  scenario: string | null;
  site: string | null;
  process: {
    id: string;
    owner: string;
    /**
     * The process entity's `dataSource`: its statement of what kind of data this is.
     * Null means absent or unrecognised; null is not "simulated". A response is only
     * ever served publicly when this is `simulated`.
     */
    dataSource: DataSource | null;
    /** The process entity's `dataProvenance`, if it also carries one. Otherwise null. */
    dataProvenance: DataSource | null;
  };
  run: {
    /** `lastRun` of the process entity. */
    id: string;
    /** `lastRunAt` of the process entity, ISO 8601 UTC. Null if absent or unreadable. */
    at: string | null;
  };
  model: {
    id: string | null;
    version: string | null;
    provenance: ModelProvenance;
    mlModelEntity: string | null;
  } | null;
  dataStatus: {
    /** At least one result or figure is simulated. */
    simulated: boolean;
    /** At least one result comes from a placeholder model. */
    placeholderModel: boolean;
    /** True only when every result is measured, from a fitted model, inside its range. */
    validated: boolean;
    /** A sentence the UI can show as is. Empty when `validated` is true. */
    notice: string;
  };
  /** Zero to three entries, in the order pcb, cu, al. Missing ones are not invented. */
  results: MaterialResult[];
  missingMaterials: MaterialCode[];
  /** In English. The same sentences in Greek are in `translations.el.warnings`. */
  warnings: string[];
  /** The readable text of this response in other languages. English is in the fields above. */
  translations: {
    el: {
      /** `dataStatus.notice` in Greek. Empty when the notice is empty. */
      notice: string;
      /** `warnings` in Greek: same length, same order. */
      warnings: string[];
      /** `materialLabel` in Greek, for every material code, returned or not. */
      materialLabels: Record<MaterialCode, string>;
    };
  };
}

export interface LatestRunResponse extends LatestRun {
  /** `mock` is only possible outside production. */
  source: 'middleware' | 'mock';
  /** When the proxy read this from the middleware, ISO 8601 UTC. */
  fetchedAt: string;
  /** True when the middleware could not be reached and an earlier good read is served. */
  stale: boolean;
}

export interface ErrorResponse {
  error: {
    /** Stable, for programs. */
    code: string;
    /** For people, in English. Safe to show as is. */
    message: string;
    translations: { el: { message: string } };
  };
}
