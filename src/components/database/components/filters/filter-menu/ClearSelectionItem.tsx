import { useTranslation } from 'react-i18next';

import { useConditionsReadOnly } from '@/application/database-yjs';
import { filterValueItemClassName } from '@/components/database/components/filters/value-controls/filter-value-item';

/**
 * Desktop parity: the plain "Clear selection" row appended to select / person /
 * relation filter editors when a value is selected (divider + text item).
 * Presentational: the host decides whether the selection can be cleared.
 */
export function ClearSelectionRow({
  onClear,
  'data-testid': testId = 'filter-clear-selection',
}: {
  onClear: () => void;
  'data-testid'?: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className={'my-2 border-t border-border-primary'} />
      <button
        type='button'
        className={filterValueItemClassName}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      >
        {t('grid.filter.clearSelection')}
      </button>
    </>
  );
}

/** `ClearSelectionRow` of a view filter editor: hidden while the view's conditions are read-only. */
function ClearSelectionItem({ onClear }: { onClear: () => void }) {
  const readOnly = useConditionsReadOnly();

  if (readOnly) return null;

  return <ClearSelectionRow onClear={onClear} />;
}

export default ClearSelectionItem;
