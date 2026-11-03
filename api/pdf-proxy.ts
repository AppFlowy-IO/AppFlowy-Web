import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { handlePDFProxy } from './_lib/pdf-proxy-response';

import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };

  const headers = new Headers();

  for (const name of ['range', 'sec-fetch-site']) {
    const value = req.headers[name];

    if (typeof value === 'string') headers.set(name, value);
  }

  req.on('aborted', abort);
  res.on('close', abort);
  try {
    const response = await handlePDFProxy(new Request(new URL(req.url ?? '/', 'http://localhost'), {
      method: req.method, headers, signal: controller.signal,
    }));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // Stream with backpressure instead of buffering the PDF in a serverless response.
    if (response.body) await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
    else res.end();
  } catch {
    if (!res.headersSent && !controller.signal.aborted) {
      res.statusCode = 502;
      res.end('Unable to load public PDF');
    } else res.destroy();
  } finally {
    controller.abort();
    req.off('aborted', abort);
    res.off('close', abort);
  }
}
