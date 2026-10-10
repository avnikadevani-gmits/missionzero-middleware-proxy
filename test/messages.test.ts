import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ERRORS, MATERIAL_LABELS, NOTICES, REASONS, SHARED_FIELDS, WARNINGS, type Message } from '../src/messages.js';
import { buildLatestRun, readLatestRun } from '../src/twin.js';
import { UpstreamError } from '../src/upstream.js';
import { findOp, LATEST, operationsFixture, processFixture, testConfig, type Raw } from './helpers.js';

const GREEK = /[Ͱ-Ͽἀ-῿]/;

const build = (edit?: (p: Raw, ops: Raw[]) => void) => {
  const p = processFixture();
  const ops = operationsFixture();
  edit?.(p, ops);
  return buildLatestRun(p, ops);
};

/** Every message the catalogue can produce, with representative arguments. */
const everyMessage = (): Message[] => [
  ...Object.values(ERRORS),
  ...Object.values(NOTICES).filter((n) => n.en !== ''),
  ...Object.values(SHARED_FIELDS),
  ...Object.values(SHARED_FIELDS).map((f) => WARNINGS.disagreement(f)),
  WARNINGS.runTimeMissing(),
  ...(['pcb', 'cu', 'al'] as const).flatMap((m) => [
    WARNINGS.notPublished(m),
    WARNINGS.publishedTwice(m),
    WARNINGS.rangeNotStated(m),
    WARNINGS.unreadable(m, REASONS.outOfBounds('purity')),
  ]),
  REASONS.materialMismatch(),
  REASONS.noProvenance('dataProvenance'),
  REASONS.notANumber('purity'),
  REASONS.outOfBounds('recoveryRate'),
  REASONS.noDataSource('cycleTime'),
];

describe('the message catalogue', () => {
  it('has English and Greek for every message, and neither is the other', () => {
    for (const m of everyMessage()) {
      expect(m.en.trim()).not.toBe('');
      expect(m.el.trim()).not.toBe('');
      expect(m.en).not.toMatch(GREEK);
      expect(m.el).toMatch(GREEK);
    }
  });

  it('names the materials in both languages', () => {
    expect(MATERIAL_LABELS).toEqual({
      pcb: { en: 'PCB', el: 'PCB' },
      cu: { en: 'Copper', el: 'Χαλκός' },
      al: { en: 'Aluminium', el: 'Αλουμίνιο' },
    });
  });

  it('keeps payload field names untranslated inside Greek sentences', () => {
    expect(REASONS.outOfBounds('purity').el).toContain('purity');
    expect(REASONS.noDataSource('recoveryRate').el).toContain('recoveryRate');
    expect(REASONS.noDataSource('recoveryRate').el).toContain('dataSource');
    expect(REASONS.noProvenance('modelProvenance').el).toContain('modelProvenance');
  });

  it('leaves no English material name in a Greek per-material warning', () => {
    for (const w of [WARNINGS.notPublished('cu'), WARNINGS.publishedTwice('al'), WARNINGS.rangeNotStated('cu')]) {
      expect(w.el).not.toMatch(/Copper|Aluminium/);
      expect(w.el).toMatch(/^(Χαλκός|Αλουμίνιο): /);
    }
  });
});

describe('Greek in the latest-run response', () => {
  it('carries the notice and all material names for a clean run, and leaves English where it was', () => {
    const run = build();
    expect(run.dataStatus.notice).toBe(NOTICES.simulatedPlaceholder.en);
    expect(run.results.map((r) => r.materialLabel)).toEqual(['PCB', 'Copper', 'Aluminium']);
    expect(run.warnings).toEqual([]);
    expect(run.translations).toEqual({
      el: {
        notice: 'Προσομοιωμένα αποτελέσματα από δοκιμαστικό μοντέλο (placeholder). Δεν αποτελούν επικυρωμένες μετρήσεις παραγωγής.',
        warnings: [],
        materialLabels: { pcb: 'PCB', cu: 'Χαλκός', al: 'Αλουμίνιο' },
      },
    });
  });

  it.each([
    ['a missing material', (_p: Raw, ops: Raw[]) => void ops.splice(ops.indexOf(findOp(ops, LATEST, 'cu')), 1), WARNINGS.notPublished('cu')],
    ['a duplicate', (_p: Raw, ops: Raw[]) => void ops.push(structuredClone(findOp(ops, LATEST, 'al'))), WARNINGS.publishedTwice('al')],
    ['an unstated range', (_p: Raw, ops: Raw[]) => void delete findOp(ops, LATEST, 'pcb').ibotInValidatedRange, WARNINGS.rangeNotStated('pcb')],
    ['an out-of-bounds figure', (_p: Raw, ops: Raw[]) => void (findOp(ops, LATEST, 'cu').purity.value = 140), WARNINGS.unreadable('cu', REASONS.outOfBounds('purity'))],
    ['a figure that is not a number', (_p: Raw, ops: Raw[]) => void (findOp(ops, LATEST, 'al').recoveryRate.value = 'x'), WARNINGS.unreadable('al', REASONS.notANumber('recoveryRate'))],
    ['a material mismatch', (_p: Raw, ops: Raw[]) => void (findOp(ops, LATEST, 'pcb').material.value = 'cu'), WARNINGS.unreadable('pcb', REASONS.materialMismatch())],
    ['a missing provenance', (_p: Raw, ops: Raw[]) => void delete findOp(ops, LATEST, 'cu').dataProvenance, WARNINGS.unreadable('cu', REASONS.noProvenance('dataProvenance'))],
    ['a model disagreement', (_p: Raw, ops: Raw[]) => void (findOp(ops, LATEST, 'al').modelVersion.value = '9'), WARNINGS.disagreement(SHARED_FIELDS.model)],
    ['a site disagreement', (_p: Raw, ops: Raw[]) => void (findOp(ops, LATEST, 'al').refSite.value = 'ManufacturingMachine:x'), WARNINGS.disagreement(SHARED_FIELDS.site)],
    ['an unreadable run time', (p: Raw) => void (p.lastRunAt.value = 'yesterday'), WARNINGS.runTimeMissing()],
  ])('gives %s the same warning in both languages', (_name, edit, expected) => {
    const run = build(edit);
    expect(run.warnings).toEqual([expected.en]);
    expect(run.translations.el.warnings).toEqual([expected.el]);
  });

  it('keeps Greek warnings in step with English ones when there are several', () => {
    const run = build((p, ops) => {
      p.lastRunAt.value = 'yesterday';
      ops.splice(ops.indexOf(findOp(ops, LATEST, 'pcb')), 1);
      findOp(ops, LATEST, 'cu').purity.value = 140;
      delete findOp(ops, LATEST, 'al').ibotInValidatedRange;
    });
    const expected = [
      WARNINGS.runTimeMissing(),
      WARNINGS.notPublished('pcb'),
      WARNINGS.unreadable('cu', REASONS.outOfBounds('purity')),
      WARNINGS.rangeNotStated('al'),
    ];
    expect(run.warnings).toEqual(expected.map((w) => w.en));
    expect(run.translations.el.warnings).toEqual(expected.map((w) => w.el));
    for (const w of run.translations.el.warnings) expect(w).toMatch(GREEK);
  });

  it('translates each notice', () => {
    const empty = build((_p, ops) => void ops.splice(0, ops.length));
    expect(empty.dataStatus.notice).toBe(NOTICES.noResults.en);
    expect(empty.translations.el.notice).toBe(NOTICES.noResults.el);

    const fitted = build((_p, ops) => {
      for (const m of ['pcb', 'cu', 'al']) findOp(ops, LATEST, m).modelProvenance.value = 'fitted';
    });
    expect(fitted.dataStatus.notice).toBe(NOTICES.simulated.en);
    expect(fitted.translations.el.notice).toBe(NOTICES.simulated.el);
  });

  it('does not let translation text affect the safety decision', () => {
    const clean = readLatestRun(processFixture(), operationsFixture());
    expect(clean.previewBlockers).toEqual([]);
    for (const blocker of readLatestRun({ ...processFixture(), dataSource: undefined }, operationsFixture()).previewBlockers) {
      expect(blocker).not.toMatch(GREEK);
    }
  });
});

describe('Greek in error responses', () => {
  let app: FastifyInstance;
  afterEach(() => app?.close());
  const start = async (getLatest: () => Promise<never>, overrides = {}) => {
    app = await buildApp({ config: testConfig(overrides), getLatest, logger: false });
  };
  const down = () => Promise.reject(new UpstreamError('network', 'x'));
  const PATH = '/api/digital-twin/latest';

  it.each([
    ['400', { method: 'GET', url: `${PATH}?x=1` }, 400, ERRORS.noParameters],
    ['403', { method: 'GET', url: PATH, headers: { origin: 'https://evil.example' } }, 403, ERRORS.originNotAllowed],
    ['404', { method: 'GET', url: '/nope' }, 404, ERRORS.notFound],
    ['405', { method: 'POST', url: PATH }, 405, ERRORS.methodNotAllowed],
    ['502', { method: 'GET', url: PATH }, 502, ERRORS.upstreamUnavailable],
  ] as const)('answers %s with the message in both languages', async (_name, request, status, expected) => {
    await start(down);
    const res = await app.inject(request);
    expect(res.statusCode).toBe(status);
    expect(res.json().error.message).toBe(expected.en);
    expect(res.json().error.translations).toEqual({ el: { message: expected.el } });
  });

  it('answers 504 and 429 with the message in both languages', async () => {
    await start(() => Promise.reject(new UpstreamError('timeout', 'x')), { rateLimitPerMinute: 1 });
    expect((await app.inject({ method: 'GET', url: PATH })).json().error.translations.el.message).toBe(
      ERRORS.upstreamTimeout.el,
    );
    const limited = await app.inject({ method: 'GET', url: PATH });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toEqual({
      code: 'rate_limited',
      message: ERRORS.rateLimited.en,
      translations: { el: { message: ERRORS.rateLimited.el } },
    });
  });

  it('sends Greek as UTF-8 JSON', async () => {
    await start(down);
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toContain('Δεν βρέθηκε.');
  });
});
