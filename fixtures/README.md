# Test data, not live results

These files are used by the tests and by `MIDDLEWARE_MODE=mock`. They are never
served when `NODE_ENV=production`.

- `operations.json`: the sample read from the middleware on 05-10-2026 that ships
  with the MissionZero frontend (three simulated SC4 runs), with two additions made
  for testing: an `owner` field on every entity, and one entity of a made-up other
  partner so the owner filter has something to exclude.
- `sc4-sample-payload-from-the-middleware.json`: the file from the client's
  handover package, unchanged. A real read-back of the three SC4 results of run
  `sc4-1791154762922` (dummy data, placeholder model), in the envelope the twin
  writes. Its entities use `id` / `type`; the middleware API answers with
  `entityId` / `entityType`, and `test/sample-payload.test.ts` applies that rename
  before running them through the proxy. It contains no process entity.
- `process.json`: a minimal `GenericProcess:cyclefi-digital-twin` built from the
  integration brief (`lastRun`, `lastRunAt`, `owner`) and the `dataSource`
  attribute reported from an actual middleware process entity
  (`{"type": "Text", "value": "simulated"}`). The full live entity has not been
  seen, so the shape of the other fields is still to confirm against the
  middleware.
