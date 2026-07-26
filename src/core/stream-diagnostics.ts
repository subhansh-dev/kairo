/**
 * Stream diagnostics — track streaming response diagnostics.
 */

export interface StreamDiag {
  startedAt: number;
  firstChunkAt: number | null;
  chunks: number;
  bytes: number;
  headers: Record<string, string>;
  httpStatus: number | null;
}

/**
 * Create a fresh stream diagnostic tracker.
 */
export function createStreamDiag(): StreamDiag {
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
 * Record a chunk arrival.
 */
export function recordChunk(diag: StreamDiag, chunkBytes: number): void {
  diag.chunks++;
  diag.bytes += chunkBytes;
  if (diag.firstChunkAt === null) diag.firstChunkAt = Date.now();
}

/**
 * Record HTTP response headers.
 */
export function recordHeaders(diag: StreamDiag, headers: Record<string, string>): void {
  diag.headers = headers;
}

/**
 * Record HTTP status.
 */
export function recordStatus(diag: StreamDiag, status: number): void {
  diag.httpStatus = status;
}

/**
 * Get time to first byte (TTFB) in milliseconds.
 */
export function getTTFB(diag: StreamDiag): number | null {
  if (diag.firstChunkAt === null) return null;
  return diag.firstChunkAt - diag.startedAt;
}

/**
 * Get total duration in milliseconds.
 */
export function getDuration(diag: StreamDiag): number {
  return Date.now() - diag.startedAt;
}

/**
 * Format diagnostics for display.
 */
export function formatStreamDiag(diag: StreamDiag): string {
  const ttfb = getTTFB(diag);
  const duration = getDuration(diag);
  const parts = [
    `chunks=${diag.chunks}`,
    `bytes=${diag.bytes}`,
    `ttfb=${ttfb !== null ? `${ttfb}ms` : '-'}`,
    `duration=${duration}ms`,
  ];
  if (diag.httpStatus) parts.unshift(`status=${diag.httpStatus}`);
  return parts.join(' ');
}

/**
 * Flatten an exception chain for display.
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
  return seen.map(e => {
    const name = (e as any).constructor?.name || 'Error';
    const msg = String((e as any).message || '').replace(/\n/g, ' ').slice(0, 100);
    return msg ? `${name}(${msg})` : name;
  }).join(' <- ');
}
