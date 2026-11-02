import i18next from 'i18next';

import { ClientValidationError, clientValidationMessages } from '../client-validation-error';
import { userFriendlyErrorMessage } from '../error-message';

it.each(['ATOMIC_CREATION_OFFLINE', 'DASHBOARD_VIEW_CREATION_OFFLINE', 'ATOMIC_CREATION_SERVER_UPGRADE', 'ATOMIC_CREATION_OWNER_CHANGED', 'ATOMIC_CREATION_PENDING', 'ROW_TEMPLATE_CONTENT_UNAVAILABLE'] as const)(
  'preserves reviewed %s guidance through a generic UI boundary',
  (reason) => {
    const error = new ClientValidationError(reason);

    expect(userFriendlyErrorMessage(error, { fallback: 'Failed to create page' })).toBe(
      clientValidationMessages[reason]
    );
    expect(error.user_error.reason).toBe(reason);
    // Matching text alone must not opt arbitrary diagnostics into public rendering.
    expect(userFriendlyErrorMessage(new Error(error.message), { fallback: 'Failed to create page' })).toBe(
      'Failed to create page'
    );
  }
);

it('preserves the selected-language atomic guidance', async () => {
  await i18next.init({
    lng: 'fr',
    resources: { fr: { translation: { atomicCreation: { offline: 'Connectez-vous pour créer cet élément.' } } } },
  });
  try {
    expect(userFriendlyErrorMessage(new ClientValidationError('ATOMIC_CREATION_OFFLINE'))).toBe(
      'Connectez-vous pour créer cet élément.'
    );
  } finally {
    await i18next.changeLanguage('en');
  }
});
