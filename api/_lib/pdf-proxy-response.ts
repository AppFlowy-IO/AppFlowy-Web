import { fetchPublicPDF, parsePDFRange, parsePublicPDFUrl, pdfChunks } from './pdf-proxy';

import type { IncomingMessage } from 'node:http';

/** Shared by the Vercel/Node function and the self-hosted Bun server. */
export async function handlePDFProxy(request: Request): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  const failure = (status: number, message: string) => {
    headers.delete('Content-Length');
    headers.delete('Content-Range');
    headers.delete('Content-Disposition');
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(message, { status, headers });
  };

  if (request.method !== 'GET') {
    headers.set('Allow', 'GET');
    return failure(405, 'Method not allowed');
  }

  if (request.headers.get('sec-fetch-site') === 'cross-site') return failure(403, 'Forbidden');
  let url: URL;
  let range: string | undefined;

  try {
    url = parsePublicPDFUrl(new URL(request.url).searchParams.get('url') ?? '');
    range = parsePDFRange(request.headers.get('range') ?? undefined);
  } catch {
    return failure(400, 'Invalid PDF request');
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 30_000);
  let upstream: IncomingMessage | undefined;
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
    upstream?.destroy();
  };

  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    upstream = await fetchPublicPDF(url.href, range, controller.signal);
    const chunks = pdfChunks(upstream, range);
    const first = await chunks.next();

    headers.set('Content-Type', 'application/pdf');
    headers.set('Content-Disposition', 'inline; filename="document.pdf"');
    for (const name of ['content-length', 'content-range', 'accept-ranges'] as const) {
      const value = upstream.headers[name];

      if (typeof value === 'string') headers.set(name, value);
    }

    const iterator = (async function* () {
      if (!first.done) yield first.value;
      yield* chunks;
    })();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const next = await iterator.next();

          if (next.done) {
            stream.close();
            cleanup();
          } else stream.enqueue(next.value);
        } catch (error) {
          stream.error(error);
          cleanup();
        }
      },
      cancel() {
        abort();
        cleanup();
        void iterator.return().catch(() => undefined);
      },
    });

    return new Response(body, { status: upstream.statusCode, headers });
  } catch {
    cleanup();
    return failure(502, 'Unable to load public PDF');
  }
}
