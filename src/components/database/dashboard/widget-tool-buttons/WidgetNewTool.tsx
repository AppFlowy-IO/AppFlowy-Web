import { DatabaseTemplateButton } from '@/components/database/components/template';

/**
 * A widget's `+ New` tool (WP09 §1.3), for editors in View mode: the template
 * split button in its icon variant. `+` creates a row at the end and opens it;
 * the chevron opens the templates menu.
 */
export function WidgetNewTool() {
  return <DatabaseTemplateButton variant='icon' />;
}

export default WidgetNewTool;
