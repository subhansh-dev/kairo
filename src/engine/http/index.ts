/**
 * HTTP client — retry-aware HTTP requests.
 */

export interface HttpConfig {
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
  headers: Record<string, string>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export interface HttpError {
  status: number;
  message: string;
  retryable: boolean;
}

const DEFAULT_HTTP_CONFIG: HttpConfig = {
  timeoutMs: 30_000,
  maxRetries: 3,
  backoffMs: 1000,
  headers: {
    'Content-Type': 'application/json',
  },
};

/**
 * Create an HTTP client with retry logic.
 */
export function createHttpClient(config?: Partial<HttpConfig>): {
  get<T>(path: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>>;
  delete<T>(path: string, headers?: Record<string, string>): Promise<HttpResponse<T>>;
} {
  const cfg = { ...DEFAULT_HTTP_CONFIG, ...config };

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    const url = cfg.baseUrl ? `${cfg.baseUrl}${path}` : path;
    const headers = { ...cfg.headers, ...extraHeaders };

    let lastError: HttpError | undefined;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => { responseHeaders[key] = value; });

        let data: T;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          data = await response.json() as T;
        } else {
          data = await response.text() as unknown as T;
        }

        if (!response.ok) {
          const error: HttpError = {
            status: response.status,
            message: `HTTP ${response.status}: ${response.statusText}`,
            retryable: response.status >= 500 || response.status === 429,
          };

          if (!error.retryable || attempt === cfg.maxRetries) {
            throw error;
          }

          lastError = error;
          await sleep(cfg.backoffMs * Math.pow(2, attempt));
          continue;
        }

        return { status: response.status, headers: responseHeaders, data };
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
          lastError = error as HttpError;
          if (!lastError.retryable || attempt === cfg.maxRetries) throw lastError;
          await sleep(cfg.backoffMs * Math.pow(2, attempt));
        } else {
          throw error;
        }
      }
    }

    throw lastError ?? new Error('Request failed');
  }

  return {
    get: <T>(path: string, headers?: Record<string, string>) =>
      request<T>('GET', path, undefined, headers),
    post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      request<T>('POST', path, body, headers),
    put: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      request<T>('PUT', path, body, headers),
    delete: <T>(path: string, headers?: Record<string, string>) =>
      request<T>('DELETE', path, undefined, headers),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
