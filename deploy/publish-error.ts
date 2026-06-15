export type PublishErrorCode =
  | 'NO_DEFAULT_PAGE'
  | 'PUBLISH_VIEW_LOOKUP_FAILED'
  | 'FETCH_ERROR'
  | 'UNKNOWN_FALLBACK';

export type PublishErrorPayload = {
  code: PublishErrorCode;
  message: string;
  namespace?: string;
  publishName?: string;
  response?: unknown;
  detail?: string;
};
