# MissionZero middleware proxy

A small read-only service between the MissionZero frontend and the iBot4CRMs
middleware. It holds the middleware token on the server, makes two fixed upstream
requests, filters the answer down to Cyclefi's latest Scenario 4 Digital Twin run,
and returns that as one typed JSON document.

```text
missionzero.gr  ->  api.missionzero.gr (Nginx -> this service on 127.0.0.1, run by PM2)  ->  iBot4CRMs middleware
```

Deployment is described in [info/DEPLOYMENT.md](info/DEPLOYMENT.md). Connecting the
frontend is described in
[info/FRONTEND_INTEGRATION.md](info/FRONTEND_INTEGRATION.md). The `info/` and `team/`
folders are git-ignored: they stay on the team's machines and are not part of the
repository or of what runs on the server.

## Run it locally

Needs Node.js 22 or newer. No middleware access is required: mock mode serves the
files in `fixtures/` through the same client, filter and cache as live mode.

```bash
npm ci
cp .env.example .env      # MIDDLEWARE_MODE=mock by default
npm run dev               # http://127.0.0.1:3100
curl http://127.0.0.1:3100/api/digital-twin/latest
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with reload, reading `.env` |
| `npm test` | Run the tests |
| `npm run typecheck` | Type check sources and tests |
| `npm run prod` | Production build: type check, tests, then compile to `dist/`. Run before every push |
| `npm run live` | On the server only: pull, install runtime dependencies, restart under PM2 |
| `npm run build` | Compile to `dist/` without the checks |
| `npm start` | Run the compiled build (environment must already be set) |

## API

### `GET /api/digital-twin/latest`

Takes no parameters, headers or body. Any query string is answered with 400.

```jsonc
{
  "scenario": "SC4",
  "site": "ekan-athens",
  "process": {
    "id": "GenericProcess:cyclefi-digital-twin",
    "owner": "cyclefi",
    "dataSource": "simulated",
    "dataProvenance": null
  },
  "run": { "id": "sc4-1791154762922", "at": "2026-10-04T22:59:22.000Z" },
  "model": {
    "id": "tc-weee-vision",
    "version": "0.1.0-placeholder",
    "provenance": "placeholder",
    "mlModelEntity": "MLModel:tc-weee-vision-0.1.0-placeholder"
  },
  "dataStatus": {
    "simulated": true,
    "placeholderModel": true,
    "validated": false,
    "notice": "Simulated results from a placeholder model. These are not validated production measurements."
  },
  "results": [
    {
      "entityId": "ManufacturingMachineOperation:sc4-1791154762922-pcb",
      "material": "pcb",
      "materialLabel": "PCB",
      "recoveryRate": { "value": 99.1, "unitCode": "P1", "dataSource": "simulated" },
      "purity": { "value": 95.93, "unitCode": "P1", "dataSource": "simulated" },
      "cycleTime": { "value": 28800, "unitCode": "SEC", "dataSource": "simulated" },
      "massRecovered": null,
      "dataProvenance": "simulated",
      "modelProvenance": "placeholder",
      "modelId": "tc-weee-vision",
      "modelVersion": "0.1.0-placeholder",
      "inValidatedRange": false,
      "outOfRangeReason": "sc4-S7: target share 2.1 a% below 5"
    }
    // ... then "cu" (Copper) and "al" (Aluminium)
  ],
  "missingMaterials": [],
  "warnings": [],
  "translations": {
    "el": {
      "notice": "Προσομοιωμένα αποτελέσματα από δοκιμαστικό μοντέλο (placeholder). Δεν αποτελούν επικυρωμένες μετρήσεις παραγωγής.",
      "warnings": [],
      "materialLabels": { "pcb": "PCB", "cu": "Χαλκός", "al": "Αλουμίνιο" }
    }
  },
  "source": "middleware",
  "fetchedAt": "2026-10-10T08:00:00.000Z",
  "stale": false
}
```

The types are in [src/types.ts](src/types.ts). The names inside `results` are the
ones the frontend already uses in `TwinMaterialResult`. The exact frontend change is
in [info/FRONTEND_INTEGRATION.md](info/FRONTEND_INTEGRATION.md).

Things the frontend should rely on:

- `run.at` is when the twin last ran. It can be hours or days old; that is normal.
  `fetchedAt` is when the proxy last read the middleware.
- `results` has one to three entries. A material the middleware did not publish, or
  published in a form that cannot be trusted, is listed in `missingMaterials` with a
  sentence in `warnings`. Nothing is filled in for it. If no result at all can be
  shown, the answer is 503 `preview_locked`, not an empty list.
- `process.dataSource` is always `simulated` in a 200 answer; anything else is
  blocked. `process.dataProvenance` is `null` unless the process entity also
  carries that attribute.
- A figure that is `null` was not published. `inValidatedRange: null` means "not
  stated", not "in range".
- `dataStatus.notice` should be shown whenever it is not empty.
- `stale: true` means the middleware could not be reached and this is the last good
  read.
- `translations.el` holds the Greek for `warnings` (same order), `dataStatus.notice`
  and the material names. See "Languages" below.

Errors always have this shape, with a fixed message and no upstream detail:

```json
{
  "error": {
    "code": "upstream_unavailable",
    "message": "The data source is unavailable or returned an unusable answer.",
    "translations": { "el": { "message": "Η πηγή δεδομένων δεν είναι διαθέσιμη ή επέστρεψε μη αξιοποιήσιμη απάντηση." } }
  }
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_request` | A query string or oversized request was sent |
| 403 | `origin_not_allowed` | The `Origin` header is not an approved origin |
| 404 | `not_found` | Any other path |
| 405 | `method_not_allowed` | Anything other than GET (or a CORS preflight) |
| 429 | `rate_limited` | More than 300 requests a minute from one address |
| 502 | `upstream_unavailable` | Middleware down, rejected the token, or sent an unusable answer |
| 503 | `preview_locked` | The run is not confirmed as all-simulated; see "Production gate" |
| 504 | `upstream_timeout` | Middleware did not answer within 8 s |

### `GET /health`

Returns `{"status":"ok"}` when the process is up. It does not call the middleware.

## Languages

MissionZero is used in Greek and English. The proxy sends both in every response,
so there is no language parameter and one cached answer serves every viewer.

- English is where it has always been: `warnings`, `dataStatus.notice`,
  `results[].materialLabel`, `error.message`.
- Greek is under `translations.el` (and `error.translations.el` on errors), with
  `warnings` in the same order as the English list.
- Field names from the payload (`purity`, `dataSource`, ...) and values that come
  from the middleware (`outOfRangeReason`, model ids) are not translated.
- Reasons written to the server log are English only.

Every sentence, in both languages, is in [src/messages.ts](src/messages.ts). To
change wording or add a language, edit that file. The Greek has not yet been
reviewed by a native speaker.

## How the latest run is chosen

1. Fetch `GenericProcess:cyclefi-digital-twin`. It must have that exact id and type
   and be owned by Cyclefi, and its `lastRun` must look like `sc4-<digits>`. If not,
   the refresh fails and the operations are not fetched.
2. Fetch the `ManufacturingMachineOperation` collection.
3. Keep an operation only if its id is exactly
   `ManufacturingMachineOperation:<lastRun>-pcb`, `-cu` or `-al`, its type is
   `ManufacturingMachineOperation`, and it is owned by Cyclefi. Matching is string
   equality on the full id. Run ids and timestamps are never sorted or compared.
4. Drop a kept operation if it appears twice, if its `material` attribute contradicts
   its id, or if its provenance or figures are missing or malformed.
5. Apply the public-preview rules (see "Production gate") to the process and to
   every operation kept in step 3, including any dropped in step 4.

### Ownership

"Owned by Cyclefi" means `owner` is a non-empty list in which every entry is
`cyclefi`. The same rule applies to the process entity and to each operation.

| `owner` | Treated as |
| --- | --- |
| `["cyclefi"]` (plain list, or an NGSI attribute holding it) | Ours |
| `["other-partner"]` | Not ours |
| `["cyclefi", "other-partner"]`, in any order | Not ours |
| Missing, empty list, bare string, anything else | Not ours |

The handover sample (`fixtures/sc4-sample-payload-from-the-middleware.json`)
confirms the shape for operations: `owner` is a plain list, `["cyclefi"]`, directly
on the entity.

**The multi-owner rule is an assumption that has been kept on purpose.** The client
asked for Cyclefi-only data. What a second owner on an entity means in the
middleware has not been confirmed, and no sample shows one, so there is no evidence
either way. Until Uni Systems or the client confirm in writing that shared entities
may be shown, they are excluded. The rule is one
function, `isOwnedByCyclefi` in [src/twin.ts](src/twin.ts).

Still unconfirmed: the process entity. No full sample of it is available, so its
`owner` is assumed to have the same shape as on operations. If it does not, the
proxy answers 502. That is the safe direction, and it will show up on the first live
call.

## Cache

One result is held in memory for the whole process and shared by all viewers.

- For 15 seconds after a successful read, every request is served from memory.
- After that, the next request triggers one refresh (two upstream calls). Requests
  arriving during the refresh wait for it; they do not start their own.
- Only a fully validated result is stored. Errors are never stored.
- **Stale results:** if a refresh fails and the last good result is less than
  10 minutes old (`CACHE_STALE_MAX_SECONDS`), it is served with `stale: true`. Older
  than that, or if there has never been a good read, the request gets a 502 or 504.
  Set `CACHE_STALE_MAX_SECONDS=0` to never serve stale.
- After a failed refresh the proxy waits 5 seconds before trying upstream again.

Responses carry `Cache-Control: no-store`, so browsers and intermediaries do not keep
their own copies.

## Production gate: there is no authentication yet

This service does not authenticate anyone. CORS limits which web pages may read the
answer in a browser; it does not stop anyone calling the API directly.

That is acceptable only while the SC4 data is simulated dummy data. To make sure it
stays that way, the proxy serves a run only when it can positively confirm that, and
otherwise answers 503 `preview_locked` with no data at all
([src/access.ts](src/access.ts)).

### The public-preview rules

All of the following must hold, or the whole response is withheld:

1. **The process entity says it is simulated.** Its `dataSource` attribute must be
   exactly `simulated`. Missing, unrecognised or any other value blocks.
2. **The process entity does not contradict itself.** `dataProvenance` is not
   required on the process. If it is present, it must also be exactly `simulated`.
3. **Every Cyclefi operation of the latest run is explicitly simulated.** For each
   one:
   - `dataProvenance` must be exactly `simulated`;
   - `modelProvenance` must be present and a recognised value;
   - every figure it carries (`recoveryRate`, `purity`, `cycleTime`,
     `massRecovered`) must have `metadata.dataSource` exactly `simulated`.
4. **At least one result is returned.** A run with nothing to show confirms nothing.

How this plays out:

| Situation | Answer |
| --- | --- |
| Process and all three results simulated | 200 |
| One latest-run operation has no provenance, or a figure has no `dataSource` | 503, including the other two results |
| One latest-run operation or figure is `measured` (or `manual`, `fallback`, `unavailable`) | 503, including the simulated results |
| A latest-run operation is published twice and either copy is not simulated | 503 |
| Process `dataSource` is `measured`, missing or unreadable | 503 |
| Process `dataSource` is `simulated` but its `dataProvenance` says otherwise | 503 |
| A material is simply not published for the latest run | 200, material listed in `missingMaterials` |
| A simulated latest-run operation has an unusable number (e.g. purity 140) | 200, that material listed in `missingMaterials` |
| An older run has missing or real provenance | 200; older runs are not looked at |
| Another partner's entity has missing or real provenance, whatever its id | 200; it is not looked at and never returned |

Two points behind the table:

- **Uncertain counts as real.** A latest-run operation of ours that cannot be
  confirmed as simulated blocks the response even though that operation itself
  would not have been returned. Simulated and unconfirmed data are never served
  side by side.
- **Only our latest run can block.** The check runs after the ownership and
  exact-id filter. Entities of older runs or other partners are discarded before
  it, so they can neither appear in a response nor take the preview down.

The reason for a block is written to the server log (a line starting
`public preview refused:`) and is not sent to the caller.

Before real pilot data is shown, authentication and a server-side check that the
user may see Scenario 4 must be added in that file and called in the route before
the cache is read. Keep the cache per scenario and make the access decision per
request; do not cache per user.

## Security summary

- The middleware host, both paths and the tenancy headers are constants in
  [src/upstream.ts](src/upstream.ts). No request field reaches them. Only GET is
  sent, and redirects are treated as errors.
- The token is read from an environment variable or a file at start-up, sent only to
  the middleware, and is not logged or returned.
- TLS verification is always on. Start-up fails if `NODE_TLS_REJECT_UNAUTHORIZED=0`
  is set. A private CA is trusted through `NODE_EXTRA_CA_CERTS`.
- In production, start-up fails on mock mode, a missing token, a non-loopback
  `HOST`, or a non-https CORS origin.
- Upstream responses are limited to 5 MB and 8 seconds each.

## Layout

```text
src/config.ts     environment loading and validation
src/upstream.ts   the two fixed middleware requests; fixture fetch for mock mode
src/twin.ts       validation, ownership and latest-run filtering, response mapping
src/cache.ts      shared TTL cache with a single in-flight refresh
src/access.ts     the public-preview gate (where authentication will go)
src/messages.ts   every reader-facing sentence, in English and Greek
src/app.ts        Fastify app: routes, CORS, rate limit, headers, errors
src/server.ts     entry point
src/types.ts      response contract
fixtures/         test data (see fixtures/README.md)
test/             Vitest suites
ecosystem.config.cjs   PM2 process definition for production

Git-ignored, kept on the team's machines only:
info/             deployment guide and frontend integration guide
team/             Nginx and production environment templates used during server setup
```
