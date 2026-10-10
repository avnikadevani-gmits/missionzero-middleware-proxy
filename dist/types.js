/** The public response contract of GET /api/digital-twin/latest. */
/** Material codes as the twin writes them. Their names are in messages.ts. */
export const MATERIAL_CODES = ['pcb', 'cu', 'al'];
/** Where a value came from. The twin's closed vocabulary. */
export const DATA_SOURCES = ['measured', 'simulated', 'fallback', 'manual', 'unavailable'];
/** How the model came to exist. A different axis from DataSource. */
export const MODEL_PROVENANCES = ['fitted', 'vendor', 'placeholder', 'unstated'];
