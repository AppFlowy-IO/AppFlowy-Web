/** Reviewed guidance for client validation, separate from the Cloud-owned catalog. */
export const clientValidationMessages = {
  FORM_DEEP_DUPLICATE_UNAVAILABLE:
    'This page contains a Form and cannot be duplicated yet because its Form settings would not be preserved.',
  FORM_DEEP_DUPLICATE_CHECK_FAILED:
    'Could not verify that this database can be duplicated safely. Refresh the page and try again.',
} as const;

/**
 * Opt reviewed local guidance into the public error renderer. Accept only named
 * client reasons so network diagnostics cannot be passed as public messages.
 */
export class ClientValidationError extends Error {
  readonly sourceDomain = 'client' as const;
  readonly user_error: { schema_version: 1; reason: keyof typeof clientValidationMessages; message: string };

  constructor(reason: keyof typeof clientValidationMessages) {
    const message = clientValidationMessages[reason];

    super(message);
    this.name = 'ClientValidationError';
    this.user_error = { schema_version: 1, reason, message };
  }
}
