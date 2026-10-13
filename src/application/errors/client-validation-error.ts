import { t } from 'i18next';

/** Reviewed guidance for client validation, separate from the Cloud-owned catalog. */
export const clientValidationMessages = {
  FORM_DEEP_DUPLICATE_UNAVAILABLE:
    'This page contains a Form and cannot be duplicated yet because its Form settings would not be preserved.',
  FORM_DEEP_DUPLICATE_CHECK_FAILED:
    'Could not verify that this database can be duplicated safely. Refresh the page and try again.',
  ATOMIC_CREATION_OFFLINE: 'Connect to the internet to create this item.',
  ATOMIC_CREATION_SERVER_UPGRADE: 'Update the server to use this creation feature.',
  ATOMIC_CREATION_OWNER_CHANGED: 'The account or workspace changed. Retry in the original workspace.',
} as const;

const translationKeys: Partial<Record<keyof typeof clientValidationMessages, string>> = {
  ATOMIC_CREATION_OFFLINE: 'atomicCreation.offline',
  ATOMIC_CREATION_SERVER_UPGRADE: 'atomicCreation.serverUpgrade',
  ATOMIC_CREATION_OWNER_CHANGED: 'atomicCreation.ownerChanged',
};

/**
 * Opt reviewed local guidance into the public error renderer. Accept only named
 * client reasons so network diagnostics cannot be passed as public messages.
 */
export class ClientValidationError extends Error {
  readonly sourceDomain = 'client' as const;
  readonly user_error: { schema_version: 1; reason: keyof typeof clientValidationMessages; message: string };

  constructor(reason: keyof typeof clientValidationMessages) {
    const fallback = clientValidationMessages[reason];
    const key = translationKeys[reason];
    const message = key ? t(key, { defaultValue: fallback }) || fallback : fallback;

    super(message);
    this.name = 'ClientValidationError';
    this.user_error = { schema_version: 1, reason, message };
  }
}
