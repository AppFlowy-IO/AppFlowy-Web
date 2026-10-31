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
import { cn } from '@/lib/utils';

import {
  DASHBOARD_MOTION_FAST_CLASS,
  DASHBOARD_WIDGET_BOX_INSET,
  WIDGET_BOX_PADDING,
  WIDGET_HEADER_HEIGHT,
} from './constants';
import { useDashboardContext } from './DashboardContext';

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
  maskImage: 'linear-gradient(to bottom, #000 60%, transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent)',
};

/**
 * An empty dashboard in View mode (and for readers, and in every mobile
 * context): "Add charts, tables, lists", an outlined "Edit dashboard" button
 * for editors who can enter Edit mode, and the illustration. No border, no
 * background (WP06 §1.9).
 */
function EmptyDashboardViewMode() {
  const { t } = useTranslation();
  const { canEnterEdit, setEditing } = useDashboardContext();

  return (
    <div
      className='flex w-full flex-col items-center pt-[72px] text-center'
      data-editing='false'
      data-testid='dashboard-empty-state'
    >
      <div className='text-sm leading-5 text-dash-title' data-parity-id='dash-empty-text'>
        {t('dashboard.empty.text', { defaultValue: 'Add charts, tables, lists' })}
      </div>
      {canEnterEdit ? (
        <button
          className={cn(
            'mt-3 h-8 rounded-[6px] border border-border-primary bg-transparent px-3 text-sm font-medium leading-5 text-text-primary outline-none',
            'transition-colors hover:bg-fill-content-hover focus-visible:ring-2 focus-visible:ring-dash-accent',
            DASHBOARD_MOTION_FAST_CLASS
          )}
          data-parity-id='dash-empty-edit-button'
          data-testid='dashboard-empty-edit-dashboard-button'
          onClick={() => setEditing(true)}
          type='button'
        >
          <span data-parity-id='dash-empty-edit-button__label'>
            {t('dashboard.empty.editDashboard', { defaultValue: 'Edit dashboard' })}
          </span>
        </button>
      ) : null}
      <EmptyIllustration
        aria-hidden='true'
        className='mt-10 h-[112px] w-[288px] text-icon-tertiary opacity-50'
        data-testid='dashboard-empty-illustration'
        style={ILLUSTRATION_MASK}
      />
    </div>
  );
}

/**
 * An empty dashboard in Edit mode: one widget box at full width and the
 * default row height, with an empty header and a card holding the five faint
 * type glyphs and the "+ New view" pill, which starts the add flow.
 */
function EmptyDashboardEditPlaceholder({ onNewView, onPreload }: { onNewView: () => void; onPreload?: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className='flex w-full flex-col rounded-500 bg-dash-edit-tint'
      data-editing='true'
      data-testid='dashboard-empty-state'
      style={{
        height: DASHBOARD_DEFAULT_ROW_HEIGHT,
        marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
        marginRight: -DASHBOARD_WIDGET_BOX_INSET,
        padding: `0 ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`,
      }}
    >
      <div aria-hidden='true' className='shrink-0' style={{ height: WIDGET_HEADER_HEIGHT }} />
      <div
        className='dash-card flex min-h-0 w-full flex-1 flex-col items-center justify-center rounded-400 bg-dash-card-bg'
        data-editing='true'
        data-testid='dashboard-empty-placeholder'
      >
        <div aria-hidden='true' className='flex items-center gap-7' data-parity-id='dash-empty-type-icons'>
          {TYPE_ICONS.map(({ id, Icon }) => (
            <Icon
              className='h-6 w-6 text-text-tertiary opacity-60 [&_*]:stroke-current'
              data-parity-id={`dash-empty-type-icon-${id}`}
              data-testid='dashboard-empty-type-icon'
              key={id}
            />
          ))}
        </div>
        <button
          className={cn(
            'mt-4 flex h-7 items-center gap-1 rounded-full bg-dash-row-control-bg pl-2.5 pr-3 text-sm font-medium leading-5 text-dash-edit-title outline-none',
            'transition-colors hover:bg-dash-edit-ring focus-visible:ring-2 focus-visible:ring-dash-accent',
            DASHBOARD_MOTION_FAST_CLASS
          )}
          data-parity-id='dash-empty-new-view'
          data-testid='dashboard-empty-new-view-button'
          onClick={onNewView}
          onFocus={onPreload}
          onPointerEnter={onPreload}
          type='button'
        >
          <PlusIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-empty-new-view__icon' />
          <span data-parity-id='dash-empty-new-view__label'>
            {t('dashboard.empty.newView', { defaultValue: 'New view' })}
          </span>
        </button>
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
