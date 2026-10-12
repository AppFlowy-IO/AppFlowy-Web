import { t } from 'i18next';

const messages = {
  offline: 'Connect to the internet to create this item.',
  serverUpgrade: 'Update the server to use this creation feature.',
  ownerChanged: 'The account or workspace changed. Retry in the original workspace.',
  pending: 'Creation is pending. Retry the original request to finish.',
};

export function atomicCreationMessage(kind: keyof typeof messages): string {
  return t(`atomicCreation.${kind}`, { defaultValue: messages[kind] }) || messages[kind];
}
