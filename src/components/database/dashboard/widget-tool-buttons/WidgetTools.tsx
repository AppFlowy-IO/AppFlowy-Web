import { ComponentType } from 'react';

import {
  useConditionsReadOnly,
  useDatabaseViewLayout,
  useFiltersSelector,
  useReadOnly,
  useSortsSelector,
} from '@/application/database-yjs';
import { cn } from '@/lib/utils';

import { useWidgetPrivateSnapshot } from '../private/WidgetPrivateContext';
import {
  getDashboardWidgetTools,
  WIDGET_TOOL_SLOT_CLASS,
  WIDGET_TOOLS_CONTAINER_CLASS,
  WidgetTool,
} from '../widget-tools';
import { useWidgetContext } from '../WidgetContext';

import { WidgetFilterTool } from './WidgetFilterTool';
import { WidgetNewTool } from './WidgetNewTool';
import { WidgetSearchTool } from './WidgetSearchTool';
import { WidgetSettingsTool } from './WidgetSettingsTool';
import { WidgetSortTool } from './WidgetSortTool';

const TOOL_COMPONENTS: Record<WidgetTool, ComponentType> = {
  filter: WidgetFilterTool,
  sort: WidgetSortTool,
  search: WidgetSearchTool,
  new: WidgetNewTool,
  settings: WidgetSettingsTool,
};

/**
 * The tools of a dashboard widget's header (`getDashboardWidgetTools`), in
 * place of the database toolbar: Filter and Sort open popovers, and Edit mode
 * adds Settings, which opens the widget's settings host; View mode adds
 * Search and `+ New` for tables, lists and boards (WP09). Hidden tools keep
 * their slot and stay focusable; they show on hover, on focus, while a
 * popover or the menu is open or the search field is expanded, in Edit mode,
 * and an active filter or sort always shows (in accent), as does one with
 * unsaved private changes.
 */
export function WidgetTools() {
  const widget = useWidgetContext();
  const layout = useDatabaseViewLayout();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const filters = useFiltersSelector();
  const sorts = useSortsSelector();
  const privateParts = useWidgetPrivateSnapshot();

  // The layout is read from the view after the first render.
  if (layout === null) return null;

  const tools = getDashboardWidgetTools({
    layout,
    editing: widget.editing,
    canWrite: !readOnly,
    canEditConditions: !conditionsReadOnly,
  });
  // An active rule, or an unsaved one (the tool's dot), keeps a tool shown.
  const isActive = (tool: WidgetTool) =>
    (tool === 'filter' && (filters.length > 0 || Boolean(privateParts?.filters))) ||
    (tool === 'sort' && (sorts.length > 0 || Boolean(privateParts?.sorts)));

  if (tools.length === 0) return null;

  return (
    <div
      className={cn('group/tools flex items-center gap-0.5', WIDGET_TOOLS_CONTAINER_CLASS)}
      data-dashboard-widget='true'
      data-force-visible={widget.editing || widget.menuOpen || widget.settingsOpen ? 'true' : 'false'}
      data-has-active={tools.some(isActive) ? 'true' : 'false'}
      data-parity-id='dash-widget-tools'
      data-testid='database-actions'
    >
      {tools.map((tool) => {
        const Tool = TOOL_COMPONENTS[tool];

        return (
          <div
            className={WIDGET_TOOL_SLOT_CLASS}
            data-active={isActive(tool) ? 'true' : 'false'}
            data-widget-tool={tool}
            key={tool}
          >
            <Tool />
          </div>
        );
      })}
    </div>
  );
}

export default WidgetTools;
