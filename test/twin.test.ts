import { describe, expect, it } from 'vitest';
import { buildLatestRun } from '../src/twin.js';
import { UpstreamError } from '../src/upstream.js';
import { findOp, LATEST, OLDER, opId, operationsFixture, processFixture, type Raw } from './helpers.js';

const build = (edit?: (p: Raw, ops: Raw[]) => void) => {
  const p = processFixture();
  const ops = operationsFixture();
  edit?.(p, ops);
  return buildLatestRun(p, ops);
};

describe('the latest run', () => {
  it('returns the three results of the run the process names', () => {
    const run = build();
    expect(run.run).toEqual({ id: LATEST, at: '2026-10-04T22:59:22.000Z' });
    expect(run.process).toEqual({
      id: 'GenericProcess:cyclefi-digital-twin',
      owner: 'cyclefi',
      dataSource: 'simulated',
      dataProvenance: null,
    });
    expect(run.results.map((r) => r.entityId)).toEqual([opId(LATEST, 'pcb'), opId(LATEST, 'cu'), opId(LATEST, 'al')]);
    expect(run.results.map((r) => r.materialLabel)).toEqual(['PCB', 'Copper', 'Aluminium']);
    expect(run.missingMaterials).toEqual([]);
    expect(run.warnings).toEqual([]);
    expect(run.scenario).toBe('SC4');
    expect(run.site).toBe('ekan-athens');
  });

  it('follows lastRun, not the newest id in the collection', () => {
    const run = build((p) => {
      p.lastRun.value = OLDER;
    });
    expect(run.run.id).toBe(OLDER);
    expect(run.results.map((r) => r.entityId)).toEqual([opId(OLDER, 'pcb'), opId(OLDER, 'cu'), opId(OLDER, 'al')]);
  });

  it('excludes older runs even when they are the only ones present', () => {
    const run = build((_p, ops) => {
      ops.splice(0, ops.length, ...ops.filter((o) => !o.entityId.includes(LATEST)));
    });
    expect(run.results).toEqual([]);
    expect(run.missingMaterials).toEqual(['pcb', 'cu', 'al']);
    expect(run.dataStatus.validated).toBe(false);
  });

  it('keeps figures, units, provenance and the validation warning', () => {
    const pcb = build().results[0]!;
    expect(pcb.recoveryRate).toEqual({ value: 99.1, unitCode: 'P1', dataSource: 'simulated' });
    expect(pcb.purity).toEqual({ value: 95.93, unitCode: 'P1', dataSource: 'simulated' });
    expect(pcb.cycleTime).toEqual({ value: 28800, unitCode: 'SEC', dataSource: 'simulated' });
    expect(pcb.massRecovered).toBeNull();
    expect(pcb.dataProvenance).toBe('simulated');
    expect(pcb.modelProvenance).toBe('placeholder');
    expect(pcb.modelId).toBe('tc-weee-vision');
    expect(pcb.modelVersion).toBe('0.1.0-placeholder');
    expect(pcb.inValidatedRange).toBe(false);
    expect(pcb.outOfRangeReason).toBe('sc4-S7: target share 2.1 a% below 5');
  });

  it('labels the run as simulated, placeholder and not validated', () => {
    const run = build();
    expect(run.model).toEqual({
      id: 'tc-weee-vision',
      version: '0.1.0-placeholder',
      provenance: 'placeholder',
      mlModelEntity: 'MLModel:tc-weee-vision-0.1.0-placeholder',
    });
    expect(run.dataStatus).toMatchObject({ simulated: true, placeholderModel: true, validated: false });
    expect(run.dataStatus.notice).toMatch(/Simulated .* placeholder .* not validated/);
  });

  it('warns when a result does not state its range, and never reads that as in range', () => {
    const run = build((_p, ops) => {
      delete findOp(ops, LATEST, 'cu').ibotInValidatedRange;
    });
    expect(run.results[1]!.inValidatedRange).toBeNull();
    expect(run.warnings.join(' ')).toMatch(/Copper: .*fitted range/);
  });
});

describe('ownership', () => {
  it("excludes another partner's entities", () => {
    const run = build();
    expect(JSON.stringify(run)).not.toContain('other-partner');
  });

  it("excludes another partner's entity even when it carries one of our ids", () => {
    const run = build((_p, ops) => {
      findOp(ops, LATEST, 'al').owner = ['other-partner'];
    });
    expect(run.results.map((r) => r.material)).toEqual(['pcb', 'cu']);
    expect(run.missingMaterials).toEqual(['al']);
  });

  it.each([
    ['missing', undefined],
    ['empty list', []],
    ['a bare string', 'cyclefi'],
    ['wrong case', ['Cyclefi']],
    ['shared with another partner', ['cyclefi', 'other-partner']],
    ['a list of non-strings', [{ id: 'cyclefi' }]],
    ['null', null],
  ])('treats a malformed owner (%s) as not ours', (_name, owner) => {
    const run = build((_p, ops) => {
      const op = findOp(ops, LATEST, 'pcb');
      if (owner === undefined) delete op.owner;
      else op.owner = owner;
    });
    expect(run.missingMaterials).toEqual(['pcb']);
  });

  it('never returns a shared entity, wherever Cyclefi sits in the list', () => {
    for (const owner of [['other-partner', 'cyclefi'], { type: 'StructuredValue', value: ['cyclefi', 'x'] }]) {
      const run = build((_p, ops) => {
        findOp(ops, LATEST, 'cu').owner = owner;
      });
      expect(run.results.map((r) => r.material)).toEqual(['pcb', 'al']);
    }
  });

  it('accepts the owner as an NGSI attribute too', () => {
    const run = build((p, ops) => {
      p.owner = { type: 'StructuredValue', value: ['cyclefi'] };
      for (const o of ops) if (o.owner[0] === 'cyclefi') o.owner = { type: 'StructuredValue', value: ['cyclefi'] };
    });
    expect(run.results).toHaveLength(3);
  });
});

describe('operation ids', () => {
  it.each([
    ['a prefix', `x${opId(LATEST, 'pcb')}`],
    ['a suffix', `${opId(LATEST, 'pcb')}-old`],
    ['a longer run id', opId(`${LATEST}1`, 'pcb')],
    ['an unknown material', opId(LATEST, 'fe')],
    ['upper case material', opId(LATEST, 'PCB')],
    ['another entity type prefix', `MLModel:${LATEST}-pcb`],
  ])('excludes a look-alike id (%s)', (_name, id) => {
    const run = build((_p, ops) => {
      findOp(ops, LATEST, 'pcb').entityId = id;
    });
    expect(run.missingMaterials).toEqual(['pcb']);
    expect(JSON.stringify(run.results)).not.toContain(id);
  });

  it('excludes an entity of the wrong type', () => {
    const run = build((_p, ops) => {
      findOp(ops, LATEST, 'cu').entityType = 'MLModel';
    });
    expect(run.missingMaterials).toEqual(['cu']);
  });

  it('ignores entries that are not objects or have no id', () => {
    const run = build((_p, ops) => {
      ops.push(null as unknown as Raw, 'text' as unknown as Raw, { entityType: 'ManufacturingMachineOperation' });
    });
    expect(run.results).toHaveLength(3);
  });
});

describe('records that cannot be trusted', () => {
  it('shows none of a material published twice', () => {
    const run = build((_p, ops) => {
      const copy = structuredClone(findOp(ops, LATEST, 'al'));
      copy.purity.value = 1;
      ops.push(copy);
    });
    expect(run.results.map((r) => r.material)).toEqual(['pcb', 'cu']);
    expect(run.missingMaterials).toEqual(['al']);
    expect(run.warnings.join(' ')).toMatch(/Aluminium: .*more than once/);
  });

  it('drops a result whose material attribute contradicts its id', () => {
    const run = build((_p, ops) => {
      findOp(ops, LATEST, 'pcb').material.value = 'cu';
    });
    expect(run.missingMaterials).toEqual(['pcb']);
    expect(run.results.map((r) => r.material)).toEqual(['cu', 'al']);
  });

  it.each([
    ['no modelProvenance', (o: Raw) => delete o.modelProvenance],
    ['an unknown dataProvenance', (o: Raw) => (o.dataProvenance.value = 'guessed')],
    ['a purity that is not a number', (o: Raw) => (o.purity.value = '95')],
    ['a recovery rate above 100', (o: Raw) => (o.recoveryRate.value = 140)],
    ['a figure with no dataSource', (o: Raw) => delete o.purity.metadata.dataSource],
  ])('drops a result with %s instead of repairing it', (_name, edit) => {
    const run = build((_p, ops) => {
      edit(findOp(ops, LATEST, 'cu'));
    });
    expect(run.missingMaterials).toEqual(['cu']);
    expect(run.warnings.join(' ')).toMatch(/Copper: .*could not be read/);
  });

  it('reports a missing material and invents nothing for it', () => {
    const run = build((_p, ops) => {
      ops.splice(ops.indexOf(findOp(ops, LATEST, 'cu')), 1);
    });
    expect(run.results.map((r) => r.material)).toEqual(['pcb', 'al']);
    expect(run.missingMaterials).toEqual(['cu']);
    expect(run.warnings).toContain('Copper: no result is published for this run.');
  });

  it('says so when the results disagree about the model', () => {
    const run = build((_p, ops) => {
      findOp(ops, LATEST, 'al').modelVersion.value = '9.9.9';
    });
    expect(run.warnings.join(' ')).toMatch(/do not agree on the model/);
  });

  it('only calls a run validated when every result is measured, fitted and in range', () => {
    const run = build((_p, ops) => {
      for (const m of ['pcb', 'cu', 'al']) {
        const o = findOp(ops, LATEST, m);
        o.dataProvenance.value = 'measured';
        o.modelProvenance.value = 'fitted';
        o.ibotInValidatedRange.value = true;
        for (const f of ['purity', 'recoveryRate', 'cycleTime']) o[f].metadata.dataSource.value = 'measured';
      }
      findOp(ops, LATEST, 'al').ibotInValidatedRange.value = false;
    });
    expect(run.dataStatus).toMatchObject({ simulated: false, placeholderModel: false, validated: false });
    expect(run.dataStatus.notice).not.toBe('');
  });
});

describe('the process entity', () => {
  const rejects = (edit: (p: Raw) => void) => {
    expect(() => build((p) => edit(p))).toThrow(UpstreamError);
  };

  it('is refused when it is another entity', () => {
    rejects((p) => (p.entityId = 'GenericProcess:cyclefi-digital-twin-2'));
    rejects((p) => (p.entityType = 'ManufacturingMachineOperation'));
  });

  it('is refused when it is not owned by Cyclefi', () => {
    rejects((p) => (p.owner = ['other-partner']));
    rejects((p) => delete p.owner);
  });

  it.each([
    ['empty', []],
    ['shared with another partner', ['cyclefi', 'other-partner']],
    ['another partner listed first', ['other-partner', 'cyclefi']],
    ['a bare string', 'cyclefi'],
    ['an NGSI attribute with a mixed list', { type: 'StructuredValue', value: ['cyclefi', 'other-partner'] }],
    ['an NGSI attribute with an empty list', { type: 'StructuredValue', value: [] }],
    ['a number', 7],
  ])('is refused when its owner is %s', (_name, owner) => {
    rejects((p) => (p.owner = owner));
  });

  it('is accepted when Cyclefi is the only owner, listed once or more', () => {
    expect(build((p) => (p.owner = ['cyclefi'])).results).toHaveLength(3);
    expect(build((p) => (p.owner = ['cyclefi', 'cyclefi'])).results).toHaveLength(3);
  });

  it('reports its dataSource and dataProvenance as stated, and null when absent', () => {
    expect(build().process).toMatchObject({ dataSource: 'simulated', dataProvenance: null });
    const both = build((p) => {
      p.dataSource = { type: 'Text', value: 'measured' };
      p.dataProvenance = { type: 'Text', value: 'simulated' };
    });
    expect(both.process).toMatchObject({ dataSource: 'measured', dataProvenance: 'simulated' });
    expect(build((p) => delete p.dataSource).process.dataSource).toBeNull();
  });

  it.each([
    ['an unknown word', { type: 'Text', value: 'dummy' }],
    ['a bare string', 'simulated'],
    ['empty', { type: 'Text', value: '' }],
    ['null', null],
  ])('reports an unreadable classification (%s) as null, never as simulated', (_name, value) => {
    expect(build((p) => (p.dataSource = value)).process.dataSource).toBeNull();
    expect(build((p) => (p.dataProvenance = value)).process.dataProvenance).toBeNull();
  });

  it.each([
    ['missing', (p: Raw) => delete p.lastRun],
    ['a bare string instead of an attribute', (p: Raw) => (p.lastRun = 'sc4-1791154762922')],
    ['a number', (p: Raw) => (p.lastRun.value = 1791154762922)],
    ['empty', (p: Raw) => (p.lastRun.value = '')],
    ['another scenario', (p: Raw) => (p.lastRun.value = 'sc5-1791154762922')],
    ['carrying extra text', (p: Raw) => (p.lastRun.value = 'sc4-1791154762922-pcb')],
  ])('is refused when lastRun is %s', (_name, edit) => {
    rejects(edit);
  });

  it('is refused when it is not an object, or the operations are not a list', () => {
    expect(() => buildLatestRun(null, [])).toThrow(UpstreamError);
    expect(() => buildLatestRun([], [])).toThrow(UpstreamError);
    expect(() => buildLatestRun(processFixture(), { entities: [] })).toThrow(UpstreamError);
  });

  it('keeps the run when only lastRunAt is unreadable, and says so', () => {
    const run = build((p) => (p.lastRunAt.value = 'yesterday'));
    expect(run.run).toEqual({ id: LATEST, at: null });
    expect(run.warnings).toContain('The time of the latest run was not published.');
  });
});
