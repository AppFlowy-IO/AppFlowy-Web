import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { Button } from '@/components/ui/button';

import { useDashboardContextOptional } from './DashboardContext';
import { GlobalFilterButton } from './global-filters/GlobalFilterButton';

/**
 * Dashboard toolbar in the database tab bar: the global filter button (for
 * everyone) and the Edit / Done toggle (for users with write access).
 *
 * Renders nothing outside a `DashboardProvider`, e.g. for the one render in
 * which the tab bar still reports the previous view's layout.
 *
 * Memoized: the conditions toolbar that renders it follows every change of
 * the host database context, while this only depends on `DashboardContext`.
 */
export const DashboardActions = memo(function DashboardActions({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const dashboard = useDashboardContextOptional();

  if (!dashboard) return null;
  const { canEdit, isEditing, setEditing } = dashboard;

  return (
    <div className='flex items-center gap-1.5' data-testid='dashboard-actions'>
      <GlobalFilterButton />
      {canEdit ? (
        isEditing ? (
          <Button
            data-testid='dashboard-done-button'
            onClick={() => setEditing(false)}
            size={compact ? 'sm' : 'default'}
            type='button'
            variant='default'
          >
            {t('dashboard.done', { defaultValue: 'Done' })}
          </Button>
        ) : (
          <Button
            data-testid='dashboard-edit-button'
            onClick={() => setEditing(true)}
            size={compact ? 'sm' : 'default'}
            type='button'
            variant='outline'
          >
            <EditIcon aria-hidden='true' className='h-4 w-4' />
            {t('dashboard.edit', { defaultValue: 'Edit' })}
          </Button>
        )
      ) : null}
    </div>
  );
});

export default DashboardActions;
