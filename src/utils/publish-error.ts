export type PublishErrorPayload = {
  code: 'NO_DEFAULT_PAGE' | 'PUBLISH_VIEW_LOOKUP_FAILED' | 'FETCH_ERROR' | 'UNKNOWN_FALLBACK';
  message: string;
  namespace?: string;
  publishName?: string;
  response?: unknown;
  detail?: string;
};

declare global {
  interface Window {
    __APPFLOWY_PUBLISH_ERROR__?: PublishErrorPayload;
  }
}

export const getPublishError = (): PublishErrorPayload | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__APPFLOWY_PUBLISH_ERROR__;
};
