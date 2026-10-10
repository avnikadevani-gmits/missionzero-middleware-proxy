/**
 * The handover sample (fixtures/sc4-sample-payload-from-the-middleware.json): a real
 * read-back of the SC4 results, written by the twin in its own envelope. Its entities
 * use `id` / `type`; the middleware API itself answers with `entityId` / `entityType`,
 * so that one rename is applied here before the entities go through the proxy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertPublicPreviewAllowed } from '../src/access.js';
import { readLatestRun } from '../src/twin.js';
import { processFixture, type Raw } from './helpers.js';

const sample = JSON.parse(
  readFileSync(new URL('../fixtures/sc4-sample-payload-from-the-middleware.json', import.meta.url), 'utf8'),
) as Raw;

const asReturnedByTheApi = (): Raw[] =>
  (sample.entities as Raw[]).map(({ id, type, ...rest }) => ({ entityId: id, entityType: type, ...rest }));

const read = () => {
  const process = processFixture();
  process.lastRun.value = sample.run;
  return readLatestRun(process, asReturnedByTheApi());
};

describe('the handover sample payload', () => {
  it('states ownership as a plain list holding only cyclefi', () => {
    for (const entity of sample.entities as Raw[]) expect(entity.owner).toEqual(['cyclefi']);
  });

  it('passes the ownership, id and provenance filters in full', () => {
    const { run, previewBlockers } = read();
    expect(previewBlockers).toEqual([]);
    expect(run.missingMaterials).toEqual([]);
    expect(run.warnings).toEqual([]);
    expect(run.results.map((r) => r.entityId)).toEqual((sample.entities as Raw[]).map((e) => e.id));
    expect(() => assertPublicPreviewAllowed({ run, previewBlockers })).not.toThrow();
  });

  it('comes out with the envelope the twin wrote for the same run', () => {
    const { run } = read();
    expect(run.scenario).toBe(sample.scenario);
    expect(run.site).toBe(sample.site);
    expect(run.run.id).toBe(sample.run);
    expect(run.model).toEqual(sample.model);
  });

  it('keeps every figure, unit and flag exactly as published', () => {
    const { run } = read();
    for (const entity of sample.entities as Raw[]) {
      const result = run.results.find((r) => r.entityId === entity.id)!;
      expect(result.material).toBe(entity.material.value);
      for (const name of ['recoveryRate', 'purity', 'cycleTime'] as const) {
        expect(result[name]).toEqual({
          value: entity[name].value,
          unitCode: entity[name].metadata.unitCode.value,
          dataSource: entity[name].metadata.dataSource.value,
        });
      }
      expect(result.dataProvenance).toBe(entity.dataProvenance.value);
      expect(result.modelProvenance).toBe(entity.modelProvenance.value);
      expect(result.inValidatedRange).toBe(entity.ibotInValidatedRange.value);
      expect(result.outOfRangeReason).toBe(entity.ibotOutOfRangeReason.value);
    }
    expect(run.dataStatus).toMatchObject({ simulated: true, placeholderModel: true, validated: false });
  });
});
