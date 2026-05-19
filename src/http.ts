const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 60000;

const RETRYABLE_STATUS_CODES = new Set([403, 408, 409, 425, 429, 500, 502, 503, 504]);

type AsyncTask<T> = () => Promise<T>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRetryAfterDelayMs(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function getRateLimitDelayMs(response: Response): number | null {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining !== "0") {
    return null;
  }

  const resetAt = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  return Math.max(0, resetAt * 1000 - Date.now()) + 1000;
}

function getBackoffDelayMs(attempt: number): number {
  const exponential = DEFAULT_BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponential + jitter, DEFAULT_MAX_DELAY_MS);
}

function getRetryDelayMs(response: Response, attempt: number): number | null {
  const retryAfterDelay = getRetryAfterDelayMs(response);
  if (retryAfterDelay !== null) {
    return retryAfterDelay;
  }

  const rateLimitDelay = getRateLimitDelayMs(response);
  if (rateLimitDelay !== null) {
    return rateLimitDelay;
  }

  return RETRYABLE_STATUS_CODES.has(response.status) ? getBackoffDelayMs(attempt) : null;
}

export function createLimiter(limit: number) {
  const concurrency = Math.max(1, limit);
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (activeCount >= concurrency) {
      return;
    }

    const next = queue.shift();
    if (next) {
      next();
    }
  };

  return function schedule<T>(task: AsyncTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        activeCount += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      };

      if (activeCount < concurrency) {
        start();
        return;
      }

      queue.push(start);
    });
  };
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  resourceLabel: string,
  options?: {
    maxRetries?: number;
    maxRateLimitWaitMs?: number;
  }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? clampPositiveInt(process.env.GITHUB_MAX_RETRIES, DEFAULT_MAX_RETRIES);
  const maxRateLimitWaitMs =
    options?.maxRateLimitWaitMs ??
    clampPositiveInt(process.env.GITHUB_MAX_RATE_LIMIT_WAIT_MS, DEFAULT_MAX_RATE_LIMIT_WAIT_MS);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }

      const retryDelayMs = getRetryDelayMs(response, attempt);
      const isRateLimited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0";

      if (retryDelayMs === null || attempt === maxRetries) {
        return response;
      }

      if (isRateLimited && retryDelayMs > maxRateLimitWaitMs) {
        return response;
      }

      console.warn(
        `[HTTP] ${resourceLabel} failed with ${response.status}, retrying in ${Math.min(retryDelayMs, maxRateLimitWaitMs)}ms`
      );
      await sleep(Math.min(retryDelayMs, maxRateLimitWaitMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        throw error;
      }

      const retryDelayMs = getBackoffDelayMs(attempt);
      console.warn(`[HTTP] ${resourceLabel} failed with ${String(error)}, retrying in ${retryDelayMs}ms`);
      await sleep(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed for ${resourceLabel}`);
}