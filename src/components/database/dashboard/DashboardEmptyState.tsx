import { useTranslation } from 'react-i18next';

import { ReactComponent as DashboardIcon } from '@/assets/icons/dashboard.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { Button } from '@/components/ui/button';

import { useDashboardContext } from './DashboardContext';
import { AddWidgetButton } from './DashboardGrid';

/**
 * Shown while the dashboard has no widgets.
 *
 * - Edit mode: invites the editor to build the dashboard with a large "Add
 *   widget" button.
 * - View mode: tells every viewer the dashboard is empty; editors outside a
 *   mobile context also get an Edit button (the toolbar has one too, this one
 *   is simply closer).
 */
export function DashboardEmptyState({ onAddWidget }: { onAddWidget: () => void }) {
  const { t } = useTranslation();
  const { canEdit, canEnterEdit, isEditing, setEditing } = useDashboardContext();
  const editing = isEditing && canEdit;

  return (
    <div
      className='flex w-full flex-col items-center justify-center gap-3 rounded-400 border border-dashed border-border-primary px-6 py-12 text-center'
      data-editing={editing ? 'true' : 'false'}
      data-testid='dashboard-empty-state'
    >
      <DashboardIcon aria-hidden='true' className='h-10 w-10 text-icon-tertiary' />
      {editing ? (
        <>
          <div className='text-base font-medium text-text-primary'>
            {t('dashboard.emptyTitle', { defaultValue: 'Build your dashboard' })}
          </div>
          <div className='max-w-[420px] text-sm text-text-secondary' data-parity-id='dash-empty-text'>
            {t('dashboard.emptyHint', {
              defaultValue: 'Add widgets to show charts, tables, boards and more from any database.',
            })}
          </div>
          <div className='mt-2 w-full max-w-[320px]'>
            <AddWidgetButton emptyState onAdd={onAddWidget} />
          </div>
        </>
      ) : (
        <>
          <div className='text-sm text-text-secondary' data-parity-id='dash-empty-text'>
            {t('dashboard.emptyViewerHint', { defaultValue: 'This dashboard has no widgets yet.' })}
          </div>
          {canEnterEdit ? (
            <Button
              className='mt-2'
              data-parity-id='dash-empty-edit-button'
              data-testid='dashboard-empty-edit-button'
              onClick={() => setEditing(true)}
              type='button'
              variant='outline'
            >
              <EditIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-empty-edit-button__icon' />
              <span data-parity-id='dash-empty-edit-button__label'>{t('dashboard.edit', { defaultValue: 'Edit' })}</span>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default DashboardEmptyState;
