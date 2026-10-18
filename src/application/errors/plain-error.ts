/**
 * Plain, already translated words this client writes for people, such as "Your administrator
 * hasn't allowed you to create workspaces." They opt into the shared error renderer the same way
 * reviewed client validation does, so `getErrorMessage` shows them instead of generic guidance.
 *
 * Only for copy from the translation files. Never wrap server, library or diagnostic text: that
 * must stay out of the interface.
 */
export class PlainError extends Error {
  readonly sourceDomain = 'client' as const;
  readonly user_error: { schema_version: 1; reason: 'CLIENT_GUIDANCE'; message: string };

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PlainError';
    this.user_error = { schema_version: 1, reason: 'CLIENT_GUIDANCE', message };
  }
}
