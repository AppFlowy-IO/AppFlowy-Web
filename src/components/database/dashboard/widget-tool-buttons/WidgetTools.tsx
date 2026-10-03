import { ComponentType } from 'react';

import {
  useConditionsReadOnly,
  useDatabaseViewLayout,
  useFiltersSelector,
  useReadOnly,
  useSortsSelector,
} from '@/application/database-yjs';
import { cn } from '@/lib/utils';

import {
  getDashboardWidgetTools,
  WIDGET_TOOL_SLOT_CLASS,
  WIDGET_TOOLS_CONTAINER_CLASS,
  WidgetTool,
} from '../widget-tools';
import { useWidgetContext } from '../WidgetContext';

import { WidgetFilterTool } from './WidgetFilterTool';
import { WidgetSettingsTool } from './WidgetSettingsTool';
import { WidgetSortTool } from './WidgetSortTool';

// WP09: Search and `+ New` have no component yet (their caps are off), so they would keep an empty slot.
const TOOL_COMPONENTS: Record<WidgetTool, ComponentType | null> = {
  filter: WidgetFilterTool,
  sort: WidgetSortTool,
  search: null,
  new: null,
  settings: WidgetSettingsTool,
};

/**
 * The tools of a dashboard widget's header (`getDashboardWidgetTools`), in
 * place of the database toolbar: Filter and Sort open popovers, and Edit mode
 * adds Settings, which opens the widget's settings host. Hidden tools keep
 * their slot and stay focusable; they show on hover, on focus, while a
 * popover or the menu is open, in Edit mode, and an active filter or sort
 * always shows (in accent).
 */
export function WidgetTools() {
  const widget = useWidgetContext();
  const layout = useDatabaseViewLayout();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const filters = useFiltersSelector();
  const sorts = useSortsSelector();

  // The layout is read from the view after the first render.
  if (layout === null) return null;

  const tools = getDashboardWidgetTools({
    layout,
    editing: widget.editing,
    canWrite: !readOnly,
    canEditConditions: !conditionsReadOnly,
  });
  const isActive = (tool: WidgetTool) =>
    (tool === 'filter' && filters.length > 0) || (tool === 'sort' && sorts.length > 0);

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
            {Tool ? <Tool /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default WidgetTools;
