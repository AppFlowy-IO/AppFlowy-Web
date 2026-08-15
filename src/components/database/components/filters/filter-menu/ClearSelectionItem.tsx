import { useTranslation } from 'react-i18next';

import { useReadOnly } from '@/application/database-yjs';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Desktop parity: the plain "Clear selection" row appended to select / person /
 * relation filter editors when a value is selected (divider + text item).
 */
function ClearSelectionItem({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();

  if (readOnly) return null;

  return (
    <>
      <div className={'my-2 border-t border-border-primary'} />
      <div
        className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
        data-testid={'filter-clear-selection'}
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      >
        {t('grid.filter.clearSelection')}
      </div>
    </>
  );
}

export default ClearSelectionItem;
