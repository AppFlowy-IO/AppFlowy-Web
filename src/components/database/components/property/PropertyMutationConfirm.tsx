import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { useClearCellsWithFieldDispatch, useDeletePropertyDispatch } from '@/application/database-yjs/dispatch';
import { useDatabaseVerification } from '@/application/page-verification/database';
import { YjsDatabaseKey } from '@/application/types';
import { PropertyActionConfirm } from '@/components/database/components/property/PropertyActionConfirm';

/** Mount only while open: the confirmation owns the generation shown to the user. */
export function PropertyMutationConfirm({
  fieldId,
  kind,
  onClose,
  children,
}: {
  fieldId: string;
  kind: 'delete' | 'clear';
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const verification = useDatabaseVerification();
  const deleteProperty = useDeletePropertyDispatch();
  const clearCells = useClearCellsWithFieldDispatch();
  const [snapshot] = useState(() => ({
    verification: Number(field?.get(YjsDatabaseKey.type)) === FieldType.Verification,
    action:
      Number(field?.get(YjsDatabaseKey.type)) === FieldType.Verification
        ? kind === 'delete'
          ? verification.remove
          : verification.clear
        : () => (kind === 'delete' ? deleteProperty(fieldId) : clearCells(fieldId)),
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const deleting = kind === 'delete';
  const description = snapshot.verification
    ? deleting
      ? t('grid.verification.deletePropertyDescription', {
          defaultValue:
            'Deleting this property removes verification, verifier details, and expiration dates from every row in this database. Your rows and other properties remain.',
        })
      : t('grid.verification.clearPropertyDescription', {
          defaultValue:
            'Remove verification from all pages in this database? The property and its settings will remain.',
        })
    : t(deleting ? 'grid.field.deleteFieldPromptMessage' : 'grid.field.clearFieldPromptMessage');

  return (
    <PropertyActionConfirm
      open
      onClose={onClose}
      title={t(deleting ? 'grid.field.delete' : 'grid.field.clear')}
      description={description}
      confirmLabel={t(deleting ? 'button.delete' : 'button.clear')}
      pending={pending}
      error={error}
      onConfirm={() => {
        if (pending) return;
        setPending(true);
        setError('');
        void Promise.resolve()
          .then(snapshot.action)
          .then(onClose)
          .catch((cause: unknown) => {
            setError(
              cause instanceof Error
                ? cause.message
                : t('grid.verification.updateFailed', { defaultValue: 'Could not update Verification.' })
            );
          })
          .finally(() => setPending(false));
      }}
    >
      {children}
    </PropertyActionConfirm>
  );
}
