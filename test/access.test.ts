import { describe, expect, it } from 'vitest';
import { assertPublicPreviewAllowed, PreviewLockedError } from '../src/access.js';
import { readLatestRun, type LatestRunRead } from '../src/twin.js';
import { findOp, LATEST, OLDER, operationsFixture, processFixture, type Raw } from './helpers.js';

/** Reads the fixtures after an edit to the raw upstream payloads. */
const read = (edit?: (ops: Raw[], process: Raw) => void): LatestRunRead => {
  const process = processFixture();
  const ops = operationsFixture();
  edit?.(ops, process);
  return readLatestRun(process, ops);
};
const allowed = (r: LatestRunRead) => expect(() => assertPublicPreviewAllowed(r)).not.toThrow();
const locked = (r: LatestRunRead) => expect(() => assertPublicPreviewAllowed(r)).toThrow(PreviewLockedError);
const text = (value: unknown) => ({ type: 'Text', value });

describe('public preview: a valid simulated run', () => {
  it('is allowed when the process and every result and figure say simulated', () => {
    const r = read();
    expect(r.previewBlockers).toEqual([]);
    expect(r.run.results).toHaveLength(3);
    allowed(r);
  });
});

describe('public preview: operations of the latest run', () => {
  it('blocks the whole run when one operation has no dataProvenance', () => {
    const r = read((ops) => delete findOp(ops, LATEST, 'pcb').dataProvenance);
    // The other two are still readable and simulated; they are withheld all the same.
    expect(r.run.results.map((x) => x.material)).toEqual(['cu', 'al']);
    locked(r);
  });

  it.each(['measured', 'fallback', 'manual', 'unavailable'])('blocks when one operation is marked %s', (value) => {
    locked(read((ops) => (findOp(ops, LATEST, 'cu').dataProvenance.value = value)));
  });

  it.each([
    ['an unknown word', (o: Raw) => (o.dataProvenance.value = 'dummy')],
    ['not an attribute', (o: Raw) => (o.dataProvenance = 'simulated')],
    ['a null value', (o: Raw) => (o.dataProvenance.value = null)],
  ])('blocks when an operation dataProvenance is invalid (%s)', (_name, edit) => {
    locked(read((ops) => edit(findOp(ops, LATEST, 'al'))));
  });

  it.each([
    ['measured', (o: Raw) => (o.purity.metadata.dataSource.value = 'measured')],
    ['missing', (o: Raw) => delete o.recoveryRate.metadata.dataSource],
    ['unrecognised', (o: Raw) => (o.cycleTime.metadata.dataSource.value = 'guess')],
    ['absent with its metadata', (o: Raw) => delete o.purity.metadata],
  ])('blocks when a figure dataSource is %s', (_name, edit) => {
    locked(read((ops) => edit(findOp(ops, LATEST, 'pcb'))));
  });

  it('blocks when an operation has a missing or unrecognised modelProvenance', () => {
    locked(read((ops) => delete findOp(ops, LATEST, 'cu').modelProvenance));
    locked(read((ops) => (findOp(ops, LATEST, 'cu').modelProvenance.value = 'trained')));
  });

  it('blocks on a non-simulated duplicate even though duplicates are never returned', () => {
    const r = read((ops) => {
      const copy = structuredClone(findOp(ops, LATEST, 'al'));
      copy.dataProvenance.value = 'measured';
      ops.push(copy);
    });
    expect(r.run.results.map((x) => x.material)).toEqual(['pcb', 'cu']);
    locked(r);
  });

  it('does not block for a simulated operation that is dropped for another reason', () => {
    const r = read((ops) => (findOp(ops, LATEST, 'cu').purity.value = 140));
    expect(r.run.missingMaterials).toEqual(['cu']);
    allowed(r);
  });

  it('does not block when a material is simply not published', () => {
    allowed(read((ops) => ops.splice(ops.indexOf(findOp(ops, LATEST, 'al')), 1)));
  });

  it('blocks when no result is left to confirm anything', () => {
    locked(read((ops) => ops.splice(0, ops.length)));
  });
});

describe('public preview: entities that are not ours or not the latest run', () => {
  it('ignores an older-run operation with invalid or real provenance', () => {
    const r = read((ops) => {
      delete findOp(ops, OLDER, 'pcb').dataProvenance;
      findOp(ops, OLDER, 'cu').dataProvenance.value = 'measured';
      delete findOp(ops, OLDER, 'al').purity.metadata.dataSource;
    });
    expect(r.previewBlockers).toEqual([]);
    expect(r.run.results).toHaveLength(3);
    allowed(r);
  });

  it("ignores another partner's operation with invalid or real provenance", () => {
    const r = read((ops) => {
      const theirs = ops.find((o) => o.owner[0] === 'other-partner')!;
      theirs.dataProvenance.value = 'measured';
      delete theirs.modelProvenance;
      ops.push({ ...structuredClone(theirs), entityId: 'ManufacturingMachineOperation:other-partner-0002-pcb', dataProvenance: 'broken' });
    });
    expect(r.previewBlockers).toEqual([]);
    expect(r.run.results).toHaveLength(3);
    allowed(r);
  });

  it("ignores another partner's real data even under one of our latest-run ids, and never returns it", () => {
    const r = read((ops) => {
      const al = findOp(ops, LATEST, 'al');
      al.owner = ['other-partner'];
      al.dataProvenance.value = 'measured';
    });
    expect(r.previewBlockers).toEqual([]);
    expect(r.run.results.map((x) => x.material)).toEqual(['pcb', 'cu']);
    allowed(r);
  });

  it('ignores a look-alike id with real provenance', () => {
    const r = read((ops) => {
      const copy = structuredClone(findOp(ops, LATEST, 'pcb'));
      copy.entityId = `${copy.entityId}-v2`;
      copy.dataProvenance.value = 'measured';
      ops.push(copy);
    });
    expect(r.run.results).toHaveLength(3);
    allowed(r);
  });
});

describe('public preview: the process entity', () => {
  it('is allowed with dataSource simulated, with or without a matching dataProvenance', () => {
    allowed(read((_o, p) => (p.dataSource = text('simulated'))));
    allowed(
      read((_o, p) => {
        p.dataSource = text('simulated');
        p.dataProvenance = text('simulated');
      }),
    );
  });

  it.each(['measured', 'fallback', 'manual', 'unavailable'])('is blocked with dataSource %s', (value) => {
    const r = read((_o, p) => (p.dataSource = text(value)));
    expect(r.run.process.dataSource).toBe(value);
    locked(r);
  });

  it('is blocked when dataSource is missing', () => {
    const r = read((_o, p) => delete p.dataSource);
    expect(r.run.process.dataSource).toBeNull();
    locked(r);
  });

  it('is blocked when dataSource is missing even if dataProvenance says simulated', () => {
    locked(
      read((_o, p) => {
        delete p.dataSource;
        p.dataProvenance = text('simulated');
      }),
    );
  });

  it.each([
    ['an unknown word', text('dummy')],
    ['a bare string', 'simulated'],
    ['empty', text('')],
    ['wrong case', text('Simulated')],
    ['null', null],
    ['a list', text(['simulated'])],
  ])('is blocked when dataSource is invalid (%s)', (_name, value) => {
    locked(read((_o, p) => (p.dataSource = value)));
  });

  it.each([
    ['measured', text('measured')],
    ['an unknown word', text('dummy')],
    ['a bare string', 'simulated'],
    ['null', null],
  ])('is blocked when dataProvenance contradicts a simulated dataSource (%s)', (_name, value) => {
    const r = read((_o, p) => {
      p.dataSource = text('simulated');
      p.dataProvenance = value;
    });
    expect(r.run.process.dataSource).toBe('simulated');
    locked(r);
  });
});

describe('public preview: the document itself is checked too', () => {
  it('blocks a non-simulated value even if no blocker was recorded', () => {
    const tamper = (edit: (r: LatestRunRead) => void) => {
      const r = read();
      edit(r);
      expect(r.previewBlockers).toEqual([]);
      locked(r);
    };
    tamper((r) => (r.run.process.dataSource = 'measured'));
    tamper((r) => (r.run.process.dataSource = null));
    tamper((r) => (r.run.process.dataProvenance = 'measured'));
    tamper((r) => (r.run.results[0]!.dataProvenance = 'measured'));
    tamper((r) => (r.run.results[2]!.purity!.dataSource = 'manual'));
    tamper((r) => (r.run.results[0]!.dataProvenance = undefined as unknown as 'simulated'));
    tamper((r) => (r.run.results = []));
  });
});
