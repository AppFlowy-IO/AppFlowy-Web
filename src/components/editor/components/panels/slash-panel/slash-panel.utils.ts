import { View, ViewLayout } from '@/application/types';

export type DatabaseOption = {
  databaseId: string;
  view: View;
};

export type SlashMenuOption = {
  label: string;
  key: string;
  icon: React.ReactNode;
  keywords: string[];
  disabled?: boolean;
  onClick?: () => void;
};

/**
 * Recursively filters a view tree to only include databases
 * that match the allowed IDs set and the search keyword.
 */
export function filterViewsByDatabases(
  views: View[],
  allowedIds: Set<string>,
  keyword: string
): View[] {
  const lowercaseKeyword = keyword.toLowerCase();

  const filter = (items: View[]): View[] => {
    return items
      .map((item) => {
        const children = filter(item.children || []);
        const matchKeyword = !keyword || item.name?.toLowerCase().includes(lowercaseKeyword);
        const includeSelf = allowedIds.has(item.view_id) && matchKeyword;
        const shouldKeep = includeSelf || children.length > 0;

        if (!shouldKeep) return null;

        return { ...item, children };
      })
      .filter(Boolean) as View[];
  };

  return filter(views);
}

/**
 * Collects selectable database views from a view tree.
 * Handles both modern database containers (v0.10.7+) and legacy top-level databases.
 */
export function collectSelectableDatabaseViews(views: View[]): View[] {
  const databaseLayouts = new Set([ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar]);
  const result: View[] = [];

  const collect = (items: View[], parentIsDatabase: boolean) => {
    for (const view of items) {
      if (databaseLayouts.has(view.layout)) {
        if (view.extra?.is_database_container) {
          result.push(view);
          collect(view.children || [], true);
        } else if (!parentIsDatabase && !view.extra?.embedded) {
          result.push(view);
          collect(view.children || [], true);
        } else {
          collect(view.children || [], parentIsDatabase);
        }
      } else {
        collect(view.children || [], parentIsDatabase);
      }
    }
  };

  collect(views, false);
  return result;
}
