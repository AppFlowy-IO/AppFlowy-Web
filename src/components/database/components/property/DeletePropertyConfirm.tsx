import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields } from '@/application/database-yjs/context';
import { collectDependentFormulaFields } from '@/application/database-yjs/fields/formula/dependencies';
import { readFormulaSchemaForVersion } from '@/application/database-yjs/fields/formula/schema';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { PropertyMutationConfirm } from '@/components/database/components/property/PropertyMutationConfirm';

export function DeletePropertyConfirm({
  open,
  onClose,
  fieldId,
}: {
  open: boolean;
  onClose: () => void;
  fieldId: string;
}) {
  return open ? (
    <PropertyMutationConfirm fieldId={fieldId} kind='delete' onClose={onClose}>
      <FormulaDeletionWarning fieldId={fieldId} />
    </PropertyMutationConfirm>
  ) : null;
}

/** Only mounted while confirming deletion, so closed property menus don't watch the schema. */
function FormulaDeletionWarning({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const fields = useDatabaseFields();
  const version = useDatabaseFieldsVersion();
  const schema = readFormulaSchemaForVersion(fields, version);
  const dependents = useMemo(() => collectDependentFormulaFields(schema, fieldId), [schema, fieldId]);

  if (dependents.length === 0) return null;
  return (
    <div role={'alert'} className={'text-sm text-text-error'} data-testid={'formula-deletion-warning'}>
      <p>
        {t('grid.formula.deleteDependencyWarning', {
          defaultValue: 'Deleting this property will break the following formulas:',
        })}
      </p>
      <ul className={'appflowy-scroller mt-2 max-h-40 list-disc overflow-y-auto pl-5'}>
        {dependents.map((entry) => (
          <li key={entry.id} className={'break-words'}>
            {entry.name || t('grid.formula.title', { defaultValue: 'Formula' })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DeletePropertyConfirm;
