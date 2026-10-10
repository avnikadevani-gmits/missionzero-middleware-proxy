/**
 * Turns the two middleware answers into the public response.
 *
 * The latest run is whatever the process entity says in `lastRun`. Operations are
 * accepted only by exact id (`ManufacturingMachineOperation:<lastRun>-<material>`),
 * exact type and Cyclefi ownership. Everything else in the collection, including
 * older runs and other partners' entities, is dropped here and never leaves the
 * server. A record that cannot be read in full is dropped, not repaired.
 */
import { UpstreamError } from './upstream.js';
import { MATERIAL_LABELS, NOTICES, REASONS, SHARED_FIELDS, WARNINGS } from './messages.js';
import { DATA_SOURCES, MATERIAL_CODES, MODEL_PROVENANCES, } from './types.js';
export const PROCESS_ID = 'GenericProcess:cyclefi-digital-twin';
export const PROCESS_TYPE = 'GenericProcess';
export const OPERATION_TYPE = 'ManufacturingMachineOperation';
export const OWNER = 'cyclefi';
/** Run ids are "sc4-" followed by the run's start time in milliseconds. */
const RUN_ID = /^sc4-\d{1,20}$/;
const MAX_TEXT = 500;
const FIGURE_BOUNDS = {
    recoveryRate: { min: 0, max: 100 },
    purity: { min: 0, max: 100 },
    cycleTime: { min: 0 },
    massRecovered: { min: 0 },
};
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDataSource = (v) => typeof v === 'string' && DATA_SOURCES.includes(v);
const isModelProvenance = (v) => typeof v === 'string' && MODEL_PROVENANCES.includes(v);
/** NGSI attribute `{ type, value, metadata }`. Null when absent or not that shape. */
function attr(entity, name) {
    const a = entity[name];
    return isObject(a) && 'value' in a ? a : null;
}
function text(entity, name) {
    const v = attr(entity, name)?.value;
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT ? v : null;
}
function metaText(a, name) {
    const m = isObject(a.metadata) ? a.metadata[name] : null;
    return isObject(m) && typeof m.value === 'string' && m.value.length <= MAX_TEXT ? m.value : null;
}
/**
 * `owner` is a plain list on the entity (`["cyclefi"]`), as the handover sample shows
 * for operations; an NGSI attribute holding that list is accepted too.
 *
 * RETAINED ASSUMPTION: owned means EVERY listed owner is Cyclefi. What a second owner
 * means in the middleware has not been confirmed, and no sample shows one, so an
 * entity shared with another partner is treated as not ours. Do not relax this to
 * "includes Cyclefi" without written confirmation that shared entities may be shown.
 */
function isOwnedByCyclefi(entity) {
    const owner = entity.owner;
    const list = isObject(owner) && 'value' in owner ? owner.value : owner;
    return Array.isArray(list) && list.length > 0 && list.every((o) => o === OWNER);
}
function invalid(message) {
    return new UpstreamError('invalid', message);
}
const FIGURE_NAMES = ['recoveryRate', 'purity', 'cycleTime', 'massRecovered'];
const describe = (value) => isDataSource(value) ? `"${value}"` : value === undefined ? 'missing' : 'unrecognised';
/**
 * Why one of OUR latest-run operations cannot be confirmed as simulated. Judged on
 * the raw entity, before and apart from mapping, so that a record which is dropped
 * for being unreadable still counts against the run.
 */
function operationBlockers(entity, material) {
    const blockers = [];
    const dataProvenance = attr(entity, 'dataProvenance')?.value;
    if (dataProvenance !== 'simulated')
        blockers.push(`${material}: dataProvenance is ${describe(dataProvenance)}`);
    if (!isModelProvenance(attr(entity, 'modelProvenance')?.value)) {
        blockers.push(`${material}: modelProvenance is missing or unrecognised`);
    }
    for (const name of FIGURE_NAMES) {
        if (!(name in entity))
            continue;
        const a = attr(entity, name);
        const dataSource = a ? (metaText(a, 'dataSource') ?? undefined) : undefined;
        if (dataSource !== 'simulated')
            blockers.push(`${material}: ${name} dataSource is ${describe(dataSource)}`);
    }
    return blockers;
}
export function parseProcess(raw, warnings) {
    const entity = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (!isObject(entity))
        throw invalid('process entity is not an object');
    if (entity.entityId !== PROCESS_ID || entity.entityType !== PROCESS_TYPE) {
        throw invalid('process entity is not the expected one');
    }
    if (!isOwnedByCyclefi(entity))
        throw invalid('process entity is not owned by the expected owner');
    const lastRun = attr(entity, 'lastRun')?.value;
    if (typeof lastRun !== 'string' || !RUN_ID.test(lastRun)) {
        throw invalid('process entity has no valid lastRun');
    }
    // `dataSource` is the process's own classification and must say "simulated".
    // `dataProvenance` is optional, but when present it must say the same.
    const blockers = [];
    const dataSource = attr(entity, 'dataSource')?.value;
    if (dataSource !== 'simulated')
        blockers.push(`process: dataSource is ${describe(dataSource)}`);
    let dataProvenance = null;
    if ('dataProvenance' in entity) {
        dataProvenance = attr(entity, 'dataProvenance')?.value;
        if (dataProvenance !== 'simulated') {
            blockers.push(`process: dataProvenance is ${describe(dataProvenance ?? undefined)}`);
        }
    }
    const at = attr(entity, 'lastRunAt')?.value;
    const time = typeof at === 'string' ? Date.parse(at) : NaN;
    if (Number.isNaN(time))
        warnings.push(WARNINGS.runTimeMissing());
    return {
        lastRun,
        lastRunAt: Number.isNaN(time) ? null : new Date(time).toISOString(),
        dataSource: isDataSource(dataSource) ? dataSource : null,
        dataProvenance: isDataSource(dataProvenance) ? dataProvenance : null,
        blockers,
    };
}
/** A record of ours that cannot be shown honestly, with the reason in both languages. */
class Unreadable extends Error {
    reason;
    constructor(reason) {
        super(reason.en);
        this.reason = reason;
    }
}
/** Returns the figure, null when the twin did not publish it, or throws Unreadable. */
function figure(entity, name) {
    if (!(name in entity))
        return null;
    const a = attr(entity, name);
    if (!a || typeof a.value !== 'number' || !Number.isFinite(a.value))
        throw new Unreadable(REASONS.notANumber(name));
    const bounds = FIGURE_BOUNDS[name];
    if (bounds && (a.value < bounds.min || (bounds.max !== undefined && a.value > bounds.max))) {
        throw new Unreadable(REASONS.outOfBounds(name));
    }
    const dataSource = metaText(a, 'dataSource');
    if (!isDataSource(dataSource))
        throw new Unreadable(REASONS.noDataSource(name));
    return { value: a.value, unitCode: metaText(a, 'unitCode'), dataSource };
}
/** Throws Unreadable when the record cannot be shown honestly. */
function mapOperation(entity, entityId, material) {
    if (attr(entity, 'material')?.value !== material)
        throw new Unreadable(REASONS.materialMismatch());
    const dataProvenance = attr(entity, 'dataProvenance')?.value;
    if (!isDataSource(dataProvenance))
        throw new Unreadable(REASONS.noProvenance('dataProvenance'));
    const modelProvenance = attr(entity, 'modelProvenance')?.value;
    if (!isModelProvenance(modelProvenance))
        throw new Unreadable(REASONS.noProvenance('modelProvenance'));
    const inRange = attr(entity, 'ibotInValidatedRange')?.value;
    return {
        result: {
            entityId,
            material,
            materialLabel: MATERIAL_LABELS[material].en,
            recoveryRate: figure(entity, 'recoveryRate'),
            purity: figure(entity, 'purity'),
            cycleTime: figure(entity, 'cycleTime'),
            massRecovered: figure(entity, 'massRecovered'),
            dataProvenance,
            modelProvenance,
            modelId: text(entity, 'modelId'),
            modelVersion: text(entity, 'modelVersion'),
            inValidatedRange: typeof inRange === 'boolean' ? inRange : null,
            outOfRangeReason: text(entity, 'ibotOutOfRangeReason'),
        },
        scenario: text(entity, 'ibotScenario'),
        site: text(entity, 'refSite')?.replace(/^ManufacturingMachine:/, '') ?? null,
        mlModelEntity: text(entity, 'ibotRefMLModel'),
    };
}
export function figuresOf(r) {
    return [r.recoveryRate, r.purity, r.cycleTime, r.massRecovered].filter((f) => f !== null);
}
/** The value all results agree on; the first one, with a warning, when they do not. */
function shared(values, what, warnings) {
    if (values.length === 0)
        return null;
    if (new Set(values.map((v) => JSON.stringify(v))).size > 1)
        warnings.push(WARNINGS.disagreement(what));
    return values[0];
}
function dataStatus(results) {
    const simulated = results.some((r) => r.dataProvenance === 'simulated' || figuresOf(r).some((f) => f.dataSource === 'simulated'));
    const placeholderModel = results.some((r) => r.modelProvenance === 'placeholder');
    const validated = results.length === MATERIAL_CODES.length &&
        results.every((r) => r.dataProvenance === 'measured' &&
            r.modelProvenance === 'fitted' &&
            r.inValidatedRange === true &&
            figuresOf(r).every((f) => f.dataSource === 'measured'));
    let notice = NOTICES.none;
    if (results.length === 0)
        notice = NOTICES.noResults;
    else if (simulated && placeholderModel)
        notice = NOTICES.simulatedPlaceholder;
    else if (simulated)
        notice = NOTICES.simulated;
    else if (placeholderModel)
        notice = NOTICES.placeholder;
    else if (!validated)
        notice = NOTICES.notValidated;
    return { simulated, placeholderModel, validated, notice };
}
export function readLatestRun(processRaw, operationsRaw) {
    const warnings = [];
    const process = parseProcess(processRaw, warnings);
    const { lastRun, lastRunAt } = process;
    const previewBlockers = [...process.blockers];
    if (!Array.isArray(operationsRaw))
        throw invalid('operations response is not a list');
    // The three ids this run may have. Matching is by equality, never by substring.
    const expected = new Map(MATERIAL_CODES.map((m) => [`${OPERATION_TYPE}:${lastRun}-${m}`, m]));
    const found = new Map();
    for (const entity of operationsRaw) {
        if (!isObject(entity) || typeof entity.entityId !== 'string')
            continue;
        const material = expected.get(entity.entityId);
        if (!material || entity.entityType !== OPERATION_TYPE || !isOwnedByCyclefi(entity))
            continue;
        // From here on the entity is ours and of the latest run. Older runs and other
        // partners' entities never reach this line, so they can never block the preview.
        found.set(material, [...(found.get(material) ?? []), entity]);
        previewBlockers.push(...operationBlockers(entity, material));
    }
    const mapped = [];
    const missingMaterials = [];
    for (const material of MATERIAL_CODES) {
        const candidates = found.get(material) ?? [];
        const only = candidates[0];
        if (!only) {
            missingMaterials.push(material);
            warnings.push(WARNINGS.notPublished(material));
        }
        else if (candidates.length > 1) {
            missingMaterials.push(material);
            warnings.push(WARNINGS.publishedTwice(material));
        }
        else {
            try {
                const m = mapOperation(only, only.entityId, material);
                if (m.result.inValidatedRange === null)
                    warnings.push(WARNINGS.rangeNotStated(material));
                mapped.push(m);
            }
            catch (error) {
                if (!(error instanceof Unreadable))
                    throw error;
                missingMaterials.push(material);
                warnings.push(WARNINGS.unreadable(material, error.reason));
            }
        }
    }
    const results = mapped.map((m) => m.result);
    const model = shared(mapped.map((m) => ({
        id: m.result.modelId,
        version: m.result.modelVersion,
        provenance: m.result.modelProvenance,
        mlModelEntity: m.mlModelEntity,
    })), SHARED_FIELDS.model, warnings);
    const scenario = shared(mapped.map((m) => m.scenario), SHARED_FIELDS.scenario, warnings);
    const site = shared(mapped.map((m) => m.site), SHARED_FIELDS.site, warnings);
    const { notice, ...status } = dataStatus(results);
    const run = {
        scenario,
        site,
        process: {
            id: PROCESS_ID,
            owner: OWNER,
            dataSource: process.dataSource,
            dataProvenance: process.dataProvenance,
        },
        run: { id: lastRun, at: lastRunAt },
        model,
        dataStatus: { ...status, notice: notice.en },
        results,
        missingMaterials,
        warnings: warnings.map((w) => w.en),
        translations: {
            el: {
                notice: notice.el,
                warnings: warnings.map((w) => w.el),
                materialLabels: { pcb: MATERIAL_LABELS.pcb.el, cu: MATERIAL_LABELS.cu.el, al: MATERIAL_LABELS.al.el },
            },
        },
    };
    return { run, previewBlockers };
}
/** The public document alone, for callers that do not decide about access. */
export function buildLatestRun(processRaw, operationsRaw) {
    return readLatestRun(processRaw, operationsRaw).run;
}
/** One refresh: the process first, and the collection only if the process is ours and valid. */
export async function loadLatestRun(client) {
    const processRaw = await client.fetchProcess();
    parseProcess(processRaw, []);
    return readLatestRun(processRaw, await client.fetchOperations());
}
