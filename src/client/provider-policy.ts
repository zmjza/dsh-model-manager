/**
 * R9#3 — custom-provider defaults that make flaky 401s recover instead of
 * failing the turn.
 *
 * The harness retry policy defaults to `retryableCodes = [RATE_LIMIT, SERVER,
 * TIMEOUT, TRANSPORT]` with `maxRetries: 2`, and **excludes AUTH** — so a
 * transient 401 from a gateway (valid key, occasional spurious auth failure)
 * is never retried and the turn dies with "API key is invalid" even though the
 * key is correct (model listing works). We write a per-provider retry policy
 * on the custom providers we create/edit: max 5 attempts (first + 4 retries)
 * and AUTH added to the retryable set, so intermittent upstream 401s are
 * absorbed by a retry with exponential backoff.
 */

/** The effective per-provider retry policy for custom (pi-ai) providers. */
export const CUSTOM_RETRY_POLICY = {
  mode: 'normal',
  maxRetries: 5,
  // Default set + AUTH (the flaky-401 fix). TRANSPORT/EMPTY mirror the defaults.
  retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH'],
  backoff: {
    initialDelayMs: 500,
    maxDelayMs: 8000,
    jitterRatio: 0.1,
  },
} as const
