import { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_DEFAULT_ROW_HEIGHT } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as BarIcon } from '@/assets/icons/chart_type_bar.svg';
import { ReactComponent as DonutIcon } from '@/assets/icons/chart_type_donut.svg';
import { ReactComponent as LineIcon } from '@/assets/icons/chart_type_line.svg';
import { ReactComponent as EmptyIllustration } from '@/assets/icons/dashboard_empty_illustration.svg';
import { ReactComponent as TableIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as ListIcon } from '@/assets/icons/list.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  DASHBOARD_MOTION_FAST_CLASS,
  DASHBOARD_WIDGET_BOX_INSET,
  WIDGET_BOX_PADDING,
  WIDGET_HEADER_HEIGHT,
} from './constants';
import { useDashboardContext } from './DashboardContext';
import { DASHBOARD_CONTROL_CLASS } from './dashboard-ui';

/** The five faint type glyphs of the edit placeholder, in Notion's order (spec §10.3). */
const TYPE_ICONS: { id: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: 'list', Icon: ListIcon },
  { id: 'bar', Icon: BarIcon },
  { id: 'donut', Icon: DonutIcon },
  { id: 'table', Icon: TableIcon },
  { id: 'line', Icon: LineIcon },
];

/** The bottom 40% of the illustration fades out. */
const ILLUSTRATION_MASK = {
  maskImage: 'linear-gradient(to bottom, currentColor 60%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, currentColor 60%, transparent)',
};

/**
 * An empty dashboard in View mode (and for readers, and in every mobile
 * context): "Add charts, tables, lists", a primary "Edit dashboard" button
 * for editors who can enter Edit mode, and the illustration. An illustration and a clear heading introduce the first action.
 */
function EmptyDashboardViewMode() {
  const { t } = useTranslation();
  const { canEnterEdit, setEditing } = useDashboardContext();

  return (
    <div
      className='flex min-h-[360px] w-full flex-col items-center justify-center rounded-500 bg-surface-primary px-6 py-10 text-center'
      data-editing='false'
      data-testid='dashboard-empty-state'
    >
      <EmptyIllustration
        aria-hidden='true'
        className='mb-6 h-[112px] w-[288px] max-w-full text-icon-tertiary opacity-50'
        data-testid='dashboard-empty-illustration'
        style={ILLUSTRATION_MASK}
      />
      <div className='text-xl font-semibold leading-7 text-text-primary' data-parity-id='dash-empty-text'>
        {t('dashboard.empty.text', { defaultValue: 'Add charts, tables, lists' })}
      </div>
      {canEnterEdit ? (
        <Button
          className={cn(DASHBOARD_CONTROL_CLASS, 'mt-4 px-3 transition-colors', DASHBOARD_MOTION_FAST_CLASS)}
          data-parity-id='dash-empty-edit-button'
          data-testid='dashboard-empty-edit-dashboard-button'
          onClick={() => setEditing(true)}
          variant='default'
          type='button'
        >
          <span data-parity-id='dash-empty-edit-button__label'>
            {t('dashboard.empty.editDashboard', { defaultValue: 'Edit dashboard' })}
          </span>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * An empty dashboard in Edit mode: one widget box at full width and the
 * default row height, with a labelled header and a card holding the five view-type
 * icons and a "New view" button, which starts the add flow.
 */
function EmptyDashboardEditPlaceholder({ onNewView, onPreload }: { onNewView: () => void; onPreload?: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className='flex w-full flex-col rounded-500 bg-fill-theme-select'
      data-editing='true'
      data-testid='dashboard-empty-state'
      style={{
        height: DASHBOARD_DEFAULT_ROW_HEIGHT,
        marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
        marginRight: -DASHBOARD_WIDGET_BOX_INSET,
        padding: `0 ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`,
      }}
    >
      <div
        className='flex shrink-0 items-center px-3 text-sm font-medium text-text-secondary'
        style={{ height: WIDGET_HEADER_HEIGHT }}
      >
        {t('dashboard.empty.text', { defaultValue: 'Add charts, tables, lists' })}
      </div>
      <div
        className='flex min-h-0 w-full flex-1 flex-col items-center justify-center rounded-400 border border-dashed border-border-primary bg-surface-primary'
        data-editing='true'
        data-testid='dashboard-empty-placeholder'
      >
        <div
          aria-hidden='true'
          className='flex flex-wrap items-center justify-center gap-2'
          data-parity-id='dash-empty-type-icons'
        >
          {TYPE_ICONS.map(({ id, Icon }) => (
            <span className='flex h-10 w-10 items-center justify-center rounded-300 bg-fill-content-visible' key={id}>
              <Icon
                className='h-5 w-5 text-icon-secondary [&_*]:stroke-current'
                data-parity-id={`dash-empty-type-icon-${id}`}
                data-testid='dashboard-empty-type-icon'
              />
            </span>
          ))}
        </div>
        <Button
          className={cn(DASHBOARD_CONTROL_CLASS, 'mt-5 gap-1.5 px-3 transition-colors', DASHBOARD_MOTION_FAST_CLASS)}
          data-parity-id='dash-empty-new-view'
          data-testid='dashboard-empty-new-view-button'
          onClick={onNewView}
          onFocus={onPreload}
          onPointerEnter={onPreload}
          variant='outline'
          type='button'
        >
          <PlusIcon
            aria-hidden='true'
            className='h-5 w-5 text-icon-primary'
            data-parity-id='dash-empty-new-view__icon'
          />
          <span data-parity-id='dash-empty-new-view__label'>
            {t('dashboard.empty.newView', { defaultValue: 'New view' })}
          </span>
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown while the dashboard has no widgets: the edit placeholder in Edit mode
 * (writers on a desktop-class screen), the invitation otherwise.
 */
export function DashboardEmptyState({ onNewView, onPreload }: { onNewView: () => void; onPreload?: () => void }) {
  const { canEdit, isEditing } = useDashboardContext();

  if (isEditing && canEdit) return <EmptyDashboardEditPlaceholder onNewView={onNewView} onPreload={onPreload} />;
  return <EmptyDashboardViewMode />;
}

export default DashboardEmptyState;
