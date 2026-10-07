import { DatabaseSearchAction } from '@/components/database/components/conditions/DatabaseSearchAction';

/**
 * A widget's Search tool (WP09 §1.2): the compact search control. It expands
 * in place to a field `min(200px, 45%)` of the header wide; while expanded
 * (`data-search-active`) every tool of the widget stays shown. The query lives
 * in the widget's `DatabaseSearchProvider`, so it is per widget and session only.
 */
export function WidgetSearchTool() {
  return <DatabaseSearchAction variant='widget' />;
}

export default WidgetSearchTool;
