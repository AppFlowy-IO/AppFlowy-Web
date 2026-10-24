import { ReactNode } from 'react';

import { WidgetComposition, WidgetCompositionContext } from './WidgetComposition';
import WidgetHeader from './WidgetHeader';

// Part of this chunk, never lazy: a lazy header would suspend once on the
// first widget that mounts it, and that widget would list its rows under a
// blank band until the chunk resolved.
const WIDGET_COMPOSITION: WidgetComposition = { Header: WidgetHeader };

/** Hands the dashboard's widget chrome to the nested databases below it (`WidgetDatabaseHost`). */
export function WidgetCompositionProvider({ children }: { children: ReactNode }) {
  return <WidgetCompositionContext.Provider value={WIDGET_COMPOSITION}>{children}</WidgetCompositionContext.Provider>;
}

export default WidgetCompositionProvider;
