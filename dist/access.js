/**
 * THE PRODUCTION GATE.
 *
 * This service has NO authentication and NO per-user authorization. CORS is not
 * either of those: it only tells browsers which pages may read the answer.
 *
 * Serving without login is acceptable only while everything returned is simulated
 * dummy data. So that this is enforced rather than remembered, the proxy serves a
 * run only when it can positively confirm that. It refuses the WHOLE response when:
 *
 *  - the process entity's `dataSource` is anything but `simulated` (missing counts);
 *  - the process entity also carries a `dataProvenance` and it is not `simulated`;
 *  - any Cyclefi operation of the latest run has a missing, unrecognised or
 *    non-simulated `dataProvenance`, a missing or unrecognised `modelProvenance`, or
 *    a figure whose `dataSource` is missing, unrecognised or non-simulated. This
 *    holds even when that operation would have been dropped as unreadable;
 *  - no result of the run survived validation, so nothing was confirmed.
 *
 * Entities of older runs and of other partners are discarded before any of this and
 * can neither be returned nor block the preview. Uncertain is treated as real:
 * simulated and unconfirmed data are never served side by side.
 *
 * When real pilot data is to be shown, replace this check with real authentication
 * and a server-side "may this user see Scenario 4" decision, made per request in the
 * route BEFORE the cache is read. The cache holds scenario data, not user data, and
 * must stay that way: decide access per user, never cache per user.
 */
import { figuresOf } from './twin.js';
export class PreviewLockedError extends Error {
    constructor(reason) {
        super(`public preview refused: ${reason}`);
        this.name = 'PreviewLockedError';
    }
}
export function assertPublicPreviewAllowed({ run, previewBlockers }) {
    if (previewBlockers.length > 0)
        throw new PreviewLockedError(previewBlockers.join('; '));
    // The same rules again, on the document about to be sent: nothing leaves on the
    // strength of the list above alone.
    if (run.process.dataSource !== 'simulated') {
        throw new PreviewLockedError('the process entity is not marked simulated');
    }
    if (run.process.dataProvenance !== null && run.process.dataProvenance !== 'simulated') {
        throw new PreviewLockedError('the process entity states a non-simulated dataProvenance');
    }
    if (run.results.length === 0) {
        throw new PreviewLockedError('no result of the latest run could be confirmed as simulated');
    }
    for (const result of run.results) {
        if (result.dataProvenance !== 'simulated') {
            throw new PreviewLockedError(`the ${result.material} result is not marked simulated`);
        }
        if (figuresOf(result).some((f) => f.dataSource !== 'simulated')) {
            throw new PreviewLockedError(`a figure of the ${result.material} result is not marked simulated`);
        }
    }
}
