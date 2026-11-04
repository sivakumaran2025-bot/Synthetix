// Retries a network call when the failure looks temporary (timeout, dropped connection, HTTP 429/5xx).
// Permanent problems (wrong key, wrong model, bad request) are NOT retried.
export const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];

export function transient(message) {
  const err = new Error(message);
  err.transient = true;
  return err;
}

export async function withRetry(fn, { retries = 2, backoffMs = 1500, log = () => {} } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (!e.transient) throw e;
      if (attempt >= retries) {
        e.message += ` (gave up after ${attempt + 1} attempts)`;
        throw e;
      }
      attempt++;
      log(`  ! ${e.message} - retrying (${attempt}/${retries})...`);
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
}
