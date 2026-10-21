import { t } from 'i18next';

import { clientValidationMessages } from '@/application/errors/client-validation-error';

const messages = {
  offline: clientValidationMessages.ATOMIC_CREATION_OFFLINE,
  serverUpgrade: clientValidationMessages.ATOMIC_CREATION_SERVER_UPGRADE,
  ownerChanged: clientValidationMessages.ATOMIC_CREATION_OWNER_CHANGED,
  pending: clientValidationMessages.ATOMIC_CREATION_PENDING,
};

export function atomicCreationMessage(kind: keyof typeof messages): string {
  return t(`atomicCreation.${kind}`, { defaultValue: messages[kind] }) || messages[kind];
}
