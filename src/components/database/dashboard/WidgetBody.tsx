import { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { useWidgetContextOptional } from './WidgetContext';

/**
 * Frame around a widget's conditions row and viewport. In View mode the body
 * is the bordered card under the quiet title; in Edit mode the whole widget is
 * the card, so the body only fills it.
 *
 * Kept free of heavy imports: `DatabaseViews` loads it eagerly.
 */
export function WidgetBody({ children }: { children: ReactNode }) {
  const widget = useWidgetContextOptional();
  const framed = !widget || !(widget.isEditing && widget.canEdit);

  return (
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background-primary',
        framed && 'rounded-400 border border-border-primary'
      )}
      data-testid='dashboard-widget-body'
    >
      {children}
    </div>
  );
}

export default WidgetBody;
