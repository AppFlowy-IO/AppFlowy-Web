import { KeyboardEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { findDashboardWidget, replaceDashboardWidgetView } from '@/application/database-yjs/dashboard-layout';

import { useDashboardLayout } from '../DashboardContext';
import { useDashboardUi } from '../DashboardUiContext';

import { DockPanelHeader } from './DockPanelHeader';
import { useWidgetPickerSections } from './useWidgetPickerSections';
import { PickerSearchField } from './WidgetAddPicker';
import { movePickerFocus, WidgetSourceList } from './WidgetSourceList';

interface WidgetSourcePanelProps {
  widgetId: string;
  onClose: () => void;
}

/**
 * Settings › Source (WP03 with WP06's `WidgetSourceList` in replace mode):
 * the views of the widget's database and the other data sources, the current
 * view checked. Picking one swaps the widget's view in place (one undo step)
 * and closes the panel; back returns to the widget's settings.
 */
export function WidgetSourcePanel({ widgetId, onClose }: WidgetSourcePanelProps) {
  const { t } = useTranslation();
  const { rows } = useDashboardLayout();
  const { updateRows, addWidget, hostDatabaseId } = useDashboardUi();
  const widget = findDashboardWidget(rows, widgetId)?.widget;
  const picker = useWidgetPickerSections({ mode: 'replace', primaryDatabaseId: widget?.databaseId ?? hostDatabaseId });
  const listRef = useRef<HTMLDivElement>(null);

  const back = useCallback(() => {
    onClose();
    addWidget.requestWidgetSettings(widgetId);
  }, [addWidget, onClose, widgetId]);
  const pick = useCallback(
    (viewId: string, databaseId: string) => {
      updateRows((current) => replaceDashboardWidgetView(current, widgetId, viewId, databaseId));
      onClose();
    },
    [onClose, updateRows, widgetId]
  );

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePickerFocus(listRef.current, null, 1);
      return;
    }

    if (event.key !== 'Enter') return;
    const sections = picker.sectionsFor(picker.query);
    const option =
      sections.host?.options[0] ?? sections.other.groups.find((group) => group.options.length > 0)?.options[0];

    if (!option) return;
    event.preventDefault();
    pick(option.viewId, option.databaseId);
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DockPanelHeader
        onBack={back}
        onClose={onClose}
        testIdPrefix='dashboard-widget-picker'
        title={t('dashboard.picker.source', { defaultValue: 'Source' })}
      />
      <PickerSearchField
        onChange={picker.setQuery}
        onKeyDown={handleSearchKeyDown}
        placeholder={t('dashboard.picker.searchPlaceholder', { defaultValue: 'Search for a view...' })}
        value={picker.query}
      />
      <WidgetSourceList
        currentViewId={widget?.viewId}
        disabled={false}
        list={picker.list}
        listRef={listRef}
        mode='replace'
        onPickExisting={pick}
      />
    </div>
  );
}

export default WidgetSourcePanel;
