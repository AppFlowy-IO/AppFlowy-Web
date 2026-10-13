import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { handleYoutubeImport } from './_lib/youtube-import';

import type { IncomingMessage, ServerResponse } from 'http';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
  options = { baseURL: process.env.APPFLOWY_BASE_URL || 'https://test.appflowy.cloud' }
) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };

  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  req.on('aborted', abort);
  res.on('close', abort);
  try {
    const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
      method: req.method,
      headers,
      signal: controller.signal,
    });
    const response = await handleYoutubeImport(request, options);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
    else res.end();
  } catch {
    if (!res.headersSent && !controller.signal.aborted) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 502, message: 'youtubeDownloadFailed' }));
    } else res.destroy();
  } finally {
    req.off('aborted', abort);
    res.off('close', abort);
  }
}
