import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useDashboardFilters, useDashboardPrivateSummary } from '../DashboardContext';

/** Reset: a quiet 28px text button (padding 0 8, radius 6, 14/20/400). */
export const PRIVATE_RESET_CLASS =
  'h-7 !rounded-200 px-2 py-0 text-sm font-normal text-text-secondary hover:bg-fill-content-hover';
/** The peach "Save for everyone" surface (28 tall, radius 6, 14/20/500). */
export const PRIVATE_SAVE_CLASS =
  'h-7 bg-dash-save-bg text-sm font-medium text-dash-save-fg hover:bg-fill-warning-light-hover';

/**
 * The filter bar's controls for unsaved changes (WP07): Reset, and for
 * writers the peach `Save for everyone ˅` split button whose menu also
 * offers "Reset all changes". Readers get Reset only. Hidden in Edit mode
 * and while nothing is unsaved.
 */
export function DashboardSaveControls({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { hasChanges, canSave } = useDashboardPrivateSummary();
  const { saveForEveryone, resetPrivateChanges } = useDashboardFilters();
  const saveLabel = t('dashboard.private.saveForEveryone', { defaultValue: 'Save for everyone' });

  if (!hasChanges) return null;

  return (
    <div className={cn('flex items-center gap-2', className)} data-testid='dashboard-private-controls'>
      <Button
        className={PRIVATE_RESET_CLASS}
        data-parity-id='dash-global-filter-reset'
        data-testid='dashboard-global-filter-reset'
        onClick={() => resetPrivateChanges()}
        size='sm'
        variant='ghost'
      >
        {t('dashboard.private.reset', { defaultValue: 'Reset' })}
      </Button>
      {canSave ? (
        <div
          className={cn(PRIVATE_SAVE_CLASS, 'flex items-stretch overflow-hidden rounded-200 hover:bg-dash-save-bg')}
          data-parity-id='dash-global-filter-save'
        >
          <button
            className='flex items-center px-2 outline-none hover:bg-fill-warning-light-hover focus-visible:bg-fill-warning-light-hover'
            data-testid='dashboard-global-filter-save-for-everyone'
            onClick={() => saveForEveryone()}
            type='button'
          >
            {saveLabel}
          </button>
          <span aria-hidden='true' className='my-1.5 w-px bg-current opacity-20' />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t('dashboard.private.saveOptions', { defaultValue: 'More save options' })}
                className='flex w-6 items-center justify-center outline-none hover:bg-fill-warning-light-hover focus-visible:bg-fill-warning-light-hover data-[state=open]:bg-fill-warning-light-hover'
                data-testid='dashboard-global-filter-save-menu-trigger'
                type='button'
              >
                <ArrowDownIcon aria-hidden='true' className='h-4 w-4' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='w-[220px] min-w-[220px] !rounded-[10px] p-1'
              data-testid='dashboard-global-filter-save-menu'
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className='min-h-7 py-1'
                  data-testid='dashboard-save-menu-save'
                  onSelect={() => saveForEveryone()}
                >
                  {saveLabel}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='min-h-7 py-1'
                  data-testid='dashboard-save-menu-reset-all'
                  onSelect={() => resetPrivateChanges()}
                >
                  {t('dashboard.private.resetAll', { defaultValue: 'Reset all changes' })}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

export default DashboardSaveControls;
