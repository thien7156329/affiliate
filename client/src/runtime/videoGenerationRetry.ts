const nativeFetch = window.fetch.bind(window);

const TARGET_ENDPOINT = '/api/pipeline/generate-single-scene-video';
const MAX_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1800;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function makeRetryableInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.clone();
  }
  return input;
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function shouldRetryVideoGeneration(response: Response): Promise<boolean> {
  if ([502, 503, 504].includes(response.status)) return true;

  try {
    const data = await response.clone().json();
    if (data?.success && data?.video_url && data?.video_path) return false;

    const message = String(data?.error || data?.message || '').toLowerCase();
    if (!message && response.ok) {
      return Boolean(data?.success && (!data?.video_url || !data?.video_path));
    }

    return /download|local|cdp|google|sign[ -]?in|login|auth|video file|tải|tai ve|timeout|network/.test(message);
  } catch {
    return !response.ok && response.status >= 500;
  }
}

window.fetch = async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = getRequestUrl(input);
  const method = getRequestMethod(input, init);

  if (method !== 'POST' || !url.includes(TARGET_ENDPOINT)) {
    return nativeFetch(input, init);
  }

  let lastResponse: Response | null = null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await nativeFetch(makeRetryableInput(input), init);
      lastResponse = response;

      const retryable = attempt < MAX_ATTEMPTS && await shouldRetryVideoGeneration(response);
      if (!retryable) return response;

      console.warn(`[VideoGenerationRetry] Attempt ${attempt}/${MAX_ATTEMPTS} failed during Veo download. Retrying once...`);
    } catch (error: any) {
      lastError = error;
      if (error?.name === 'AbortError' || attempt >= MAX_ATTEMPTS) throw error;
      console.warn(`[VideoGenerationRetry] Network error on attempt ${attempt}/${MAX_ATTEMPTS}:`, error);
    }

    await wait(RETRY_DELAY_MS, init?.signal);
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('Video generation request failed');
};

console.info('[VideoGenerationRetry] Veo single-part retry guard enabled.');
