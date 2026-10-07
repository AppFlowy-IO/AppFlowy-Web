import { ComponentType, createContext } from 'react';

/**
 * What the dashboard chunk composes into a widget's nested database: the
 * widget header (title, tools, menu), which `WidgetDatabaseViews` renders in
 * place of the tab bar. It comes through this context, so the widget chrome
 * stays in the dashboard's chunk and out of every other database's.
 * Provided by `WidgetCompositionProvider` (under `WidgetDatabaseHost`); this
 * module is kept free of heavy imports.
 */
export interface WidgetComposition {
  Header: ComponentType;
}

export const WidgetCompositionContext = createContext<WidgetComposition | null>(null);
