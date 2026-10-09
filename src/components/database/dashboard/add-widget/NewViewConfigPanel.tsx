import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { cn } from '@/lib/utils';

import { useDashboardContext } from '../DashboardContext';
import { useDashboardUi } from '../DashboardUiContext';
import { useHostViews } from '../hooks/useHostViews';
import { useWidgetSourceName } from '../hooks/useWidgetSourceName';
import { databaseLayoutToViewLayout } from '../utils';

import { AddWidgetFlowState } from './add-widget-flow';
import { DockPanelHeader } from './DockPanelHeader';
import { CONFIG_TILE_LAYOUTS, NEW_VIEW_LAYOUT_LABELS } from './picker-sections';

type ConfiguringState = Extract<AddWidgetFlowState, { kind: 'configuring' }>;

/** The name as typed, and the view name it was typed against. */
interface NameEdit {
  base: string;
  value: string;
}

/**
 * The "New view" panel (WP06 §1.7): it replaces the picker in the dock once a
 * type was picked. The view name (commit on Enter or blur, Escape reverts),
 * the layout tiles in Notion's grid order (a tile switches the widget's own
 * view in place) and, for a chart, the Source row and the Edit chart button
 * that opens the widget's settings host in the dock.
 */
export function NewViewConfigPanel({ state }: { state: ConfiguringState }) {
  const { t } = useTranslation();
  const database = useDatabase();
  const { hostDatabaseId } = useDashboardContext();
  const { addWidget } = useDashboardUi();
  const { flow } = addWidget;
  const hostViews = useHostViews(database);
  const viewName = useMemo(
    () => hostViews.find((view) => view.viewId === state.viewId)?.name ?? '',
    [hostViews, state.viewId]
  );
  const [edit, setEdit] = useState<NameEdit | null>(null);
  // The field shows the view's name, or the draft typed against it: a rename
  // that lands (a type pick renames an untouched name) shows at once, with no
  // render of the previous draft first.
  const draft = edit && edit.base === viewName ? edit.value : viewName;
  // The name whose rename is in flight: Enter keeps the focus, so the blur
  // that follows (a tile, Back) must not rename again before it lands.
  const committedRef = useRef<string | null>(null);
  const sourceName = useWidgetSourceName(hostDatabaseId, state.layout === DatabaseViewLayout.Chart);

  // A draft typed against a name the view no longer has is over: dropped, so
  // it never shows again should the view get that name back.
  useEffect(() => {
    if (!edit || edit.base === viewName) return;
    committedRef.current = null;
    setEdit(null);
  }, [edit, viewName]);

  const label = (layout: DatabaseViewLayout) => {
    const entry = NEW_VIEW_LAYOUT_LABELS[layout];

    return t(entry.key, { defaultValue: entry.defaultValue });
  };

  const commit = () => {
    const name = draft.trim();

    if (!name || name === viewName.trim()) {
      setEdit(null);
      return;
    }

    if (name === committedRef.current) return;
    committedRef.current = name;
    flow.dispatch({ type: 'rename', name });
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }

    if (event.key === 'Escape' && draft !== viewName) {
      // The first Escape reverts the name; the next one closes the panel.
      event.preventDefault();
      event.stopPropagation();
      setEdit(null);
    }
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DockPanelHeader
        onBack={() => flow.dispatch({ type: 'back' })}
        onClose={() => flow.dispatch({ type: 'dismiss' })}
        testIdPrefix='dashboard-widget-new-view-panel'
        title={t('dashboard.picker.newView', { defaultValue: 'New view' })}
      />
      <div className='flex items-center gap-2 px-1 pb-2'>
        <span
          aria-hidden='true'
          className='flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-border-primary text-dash-tool-icon'
        >
          <ViewIcon className='h-4 w-4' layout={databaseLayoutToViewLayout(state.layout)} size='unset' />
        </span>
        <input
          aria-label={t('dashboard.picker.viewName', { defaultValue: 'View name' })}
          autoFocus
          className='h-7 min-w-0 flex-1 rounded-[6px] bg-fill-content-hover px-2 text-sm leading-5 text-text-primary outline-none focus:ring-1 focus:ring-dash-accent'
          data-dock-autofocus='true'
          data-testid='dashboard-widget-new-view-panel-name'
          onBlur={commit}
          onChange={(event) => {
            // An edited name is a new rename, whatever is in flight.
            committedRef.current = null;
            setEdit({ base: viewName, value: event.target.value });
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={handleNameKeyDown}
          placeholder={t('dashboard.picker.viewName', { defaultValue: 'View name' })}
          value={draft}
        />
      </div>
      <div className='grid grid-cols-3 gap-2 px-1 pb-2' role='radiogroup'>
        {CONFIG_TILE_LAYOUTS.map((layout) => {
          const selected = layout === state.layout;

          return (
            <button
              aria-checked={selected}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-1 rounded-[8px] border border-border-primary text-xs leading-4 text-text-primary outline-none transition-colors',
                'hover:bg-dash-hover-fill focus-visible:ring-2 focus-visible:ring-dash-accent',
                selected && 'border-2 border-dash-accent text-dash-accent'
              )}
              data-layout={String(layout)}
              data-selected={selected ? 'true' : 'false'}
              data-testid='dashboard-widget-new-view-panel-tile'
              key={layout}
              onClick={() => {
                flow.dispatch({ type: 'pick_tile', layout });
              }}
              role='radio'
              type='button'
            >
              <ViewIcon className='h-5 w-5' layout={databaseLayoutToViewLayout(layout)} size='unset' />
              <span>{label(layout)}</span>
            </button>
          );
        })}
      </div>
      {state.layout === DatabaseViewLayout.Chart ? (
        <div className='flex flex-col gap-2 px-1 pb-1'>
          <button
            className='flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
            data-testid='dashboard-widget-new-view-panel-source'
            onClick={() => {
              flow.dispatch({ type: 'dismiss' });
              addWidget.openSourcePanel(state.widgetId);
            }}
            type='button'
          >
            <span className='flex-1 truncate'>{t('dashboard.picker.source', { defaultValue: 'Source' })}</span>
            {sourceName ? (
              <span className='max-w-[140px] truncate text-xs text-text-secondary'>{sourceName}</span>
            ) : null}
            <ChevronRightIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-tertiary' />
          </button>
          <button
            className='h-8 w-full rounded-[6px] bg-fill-theme-thick text-sm font-medium leading-5 text-text-on-fill outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-dash-accent'
            data-testid='dashboard-widget-edit-chart'
            onClick={() => flow.dispatch({ type: 'edit_chart' })}
            type='button'
          >
            {t('dashboard.picker.editChart', { defaultValue: 'Edit chart' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default NewViewConfigPanel;
