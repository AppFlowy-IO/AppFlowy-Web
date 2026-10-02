import { ReactNode } from 'react';

import { useWidgetContextOptional } from './WidgetContext';

/**
 * The widget card: the page color, radius 12, and a 1px ring drawn as a
 * shadow (never a border, so it takes no space), with a faint shadow in light
 * mode. The ring turns to the edit ring in Edit mode (`.dash-card`, see
 * `dashboard-tokens.css`). The same in View and Edit mode otherwise; the
 * content runs edge to edge.
 *
 * Kept free of heavy imports: `DatabaseViews` loads it eagerly.
 */
export function WidgetBody({ children }: { children: ReactNode }) {
  const widget = useWidgetContextOptional();

  return (
    <div
      className='dash-card relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-400 bg-dash-card-bg'
      data-editing={widget?.editing ? 'true' : 'false'}
      data-parity-id='dash-widget-card'
      data-testid='dashboard-widget-body'
    >
      {children}
    </div>
  );
}

export default WidgetBody;
