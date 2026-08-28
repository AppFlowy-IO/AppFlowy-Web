type AppFlowyResponseEnvelope = {
  code?: unknown;
  message?: unknown;
};

type AppFlowyResponseDetails = {
  bodyText: string;
  ok: boolean;
  operation: string;
  status: number;
};

/**
 * AppFlowy APIs can report failures in a successful HTTP response. Test auth
 * helpers must validate both layers before continuing with a browser session.
 */
export function assertSuccessfulAppFlowyResponse({ bodyText, ok, operation, status }: AppFlowyResponseDetails): void {
  let body: AppFlowyResponseEnvelope | undefined;

  try {
    const parsed: unknown = JSON.parse(bodyText);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as AppFlowyResponseEnvelope;
    }
  } catch {
    // The error below includes the HTTP status and a bounded response preview.
  }

  if (!ok) {
    throw new Error(`${operation} failed with HTTP ${status}: ${bodyText.slice(0, 200)}`);
  }

  if (!body || typeof body.code !== 'number') {
    throw new Error(`${operation} returned an invalid AppFlowy response envelope (HTTP ${status})`);
  }

  if (body.code !== 0) {
    const message = typeof body.message === 'string' && body.message ? `: ${body.message}` : '';

    throw new Error(`${operation} failed with AppFlowy code ${body.code}${message}`);
  }
}
