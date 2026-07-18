/**
 * Stream diagnostics — per-attempt counters, exception chains, retry logging.
 *
 * When a streaming request dies mid-response, we want to know why: which
 * provider answered, how many bytes/chunks we got before the drop, the HTTP
 * status, the underlying error class.
 */

// Lightweight inline logger — no external dependency needed

// Per-attempt stream diagnostic headers to capture
const STREAM_DIAG_HEADERS = [
  'cf-ray',
  'cf-cache-status',
  'x-request-id',
  'x-vercel-id',
  'via',
  'server',
  'x-forwarded-for',
];

export interface StreamDiag {
  startedAt: number;
  firstChunkAt: number | null;
  chunks: number;
  bytes: number;
  headers: Record<string, string>;
  httpStatus: number | null;
}

/**
 * Create a fresh per-attempt diagnostic dict.
 */
export function streamDiagInit(): StreamDiag {
  return {
    startedAt: Date.now(),
    firstChunkAt: null,
    chunks: 0,
    bytes: 0,
    headers: {},
    httpStatus: null,
  };
}

/**
 * Snapshot interesting headers + HTTP status from the live stream.
 */
export function streamDiagCaptureResponse(diag: StreamDiag, httpResponse: Response | null): void {
  if (!httpResponse) return;
  try {
    diag.httpStatus = httpResponse.status;
  } catch { /* best-effort */ }
  try {
    const captured: Record<string, string> = {};
    for (const name of STREAM_DIAG_HEADERS) {
      const val = httpResponse.headers.get(name);
      if (val) captured[name] = val.slice(0, 120);
    }
    diag.headers = captured;
  } catch { /* best-effort */ }
}

/**
 * Update diagnostics when a chunk arrives.
 */
export function streamDiagRecordChunk(diag: StreamDiag, chunkBytes: number): void {
  diag.chunks++;
  diag.bytes += chunkBytes;
  if (diag.firstChunkAt === null) {
    diag.firstChunkAt = Date.now();
  }
}

/**
 * Return a compact error chain rendering.
 * Walks cause chain (max 4 deep) to surface the root cause.
 */
export function flattenExceptionChain(error: unknown): string {
  const seen: unknown[] = [];
  let link: unknown = error;
  while (link !== null && link !== undefined && seen.length < 4) {
    if (seen.includes(link)) break;
    seen.push(link);
    const nxt = (link as any).cause || (link as any).context;
    if (!nxt || nxt === link) break;
    link = nxt;
  }
  const parts: string[] = [];
  for (const e of seen) {
    const name = (e as any).constructor?.name || 'Error';
    const msg = String((e as any).message || '').trim().replace(/\n/g, ' ').slice(0, 140);
    parts.push(msg ? `${name}(${msg})` : name);
  }
  return parts.length > 0 ? parts.join(' <- ') : (error as any).constructor?.name || 'Error';
}

/**
 * Log a stream retry attempt with full diagnostic detail.
 */
export function logStreamRetry(
  opts: {
    kind: string;
    error: unknown;
    attempt: number;
    maxAttempts: number;
    midToolCall: boolean;
    provider?: string;
    diag?: StreamDiag;
    subagentId?: string;
  },
): void {
  const { kind, error, attempt, maxAttempts, midToolCall, provider, diag, subagentId } = opts;

  const chain = flattenExceptionChain(error);
  const errorMsg = error instanceof Error ? error.message : String(error);

  let bytes = 0, chunks = 0, elapsed = 0, ttfb: string | null = null;
  let headersRepr = '-', httpStatus = '-';
  if (diag) {
    bytes = diag.bytes;
    chunks = diag.chunks;
    elapsed = (Date.now() - diag.startedAt) / 1000;
    if (diag.firstChunkAt !== null) {
      ttfb = `${((diag.firstChunkAt - diag.startedAt) / 1000).toFixed(2)}s`;
    }
    const headerEntries = Object.entries(diag.headers);
    if (headerEntries.length > 0) {
      headersRepr = headerEntries.map(([k, v]) => `${k}=${v}`).join(' ');
    }
    if (diag.httpStatus !== null) httpStatus = String(diag.httpStatus);
  }

  console.warn(
    `[stream] ${kind} attempt ${attempt}/${maxAttempts} — retrying. ` +
    `subagent=${subagentId || '-'} provider=${provider || '-'} ` +
    `error=${errorMsg} chain=${chain} ` +
    `http=${httpStatus} bytes=${bytes} chunks=${chunks} elapsed=${elapsed.toFixed(2)}s ttfb=${ttfb || '-'} ` +
    `upstream=[${headersRepr}]` +
    (midToolCall ? ' mid_tool_call=true' : ''),
  );
}

/**
 * Emit a user-visible line for a stream drop + retry.
 */
export function emitStreamDrop(
  opts: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    midToolCall: boolean;
    provider?: string;
    diag?: StreamDiag;
  },
): string {
  const { error, attempt, maxAttempts, midToolCall, provider, diag } = opts;
  const kind = midToolCall ? 'drop mid tool-call' : 'drop';

  logStreamRetry({ ...opts, kind });

  let suffix = '';
  if (diag) {
    const secs = ((Date.now() - diag.startedAt) / 1000).toFixed(1);
    suffix = ` after ${secs}s`;
  }

  const errorName = error instanceof Error ? error.constructor.name : 'Error';
  return `⚠️ ${provider || 'provider'} stream ${kind} (${errorName})${suffix} — reconnecting, retry ${attempt}/${maxAttempts}`;
}
