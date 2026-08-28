import { View, ViewLayout } from '@/components/chat/types';

export function findView(views: View[], id: string): View | undefined {
  for (const view of views) {
    if (view.view_id === id) {
      return view;
    }

    if (view.children.length) {
      const found = findView(view.children, id);

      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

export function findAncestors(data: View[], targetId: string, currentPath: View[] = []): View[] | null {
  for (const item of data) {
    const newPath = [...currentPath, item];

    if (item.view_id === targetId) {
      return newPath;
    }

    if (item.children && item.children.length > 0) {
      const result = findAncestors(item.children, targetId, newPath);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function filterDocumentViews(views: View[]): View[] {
  return views
    .filter((view) => view.layout === ViewLayout.Document)
    .map((view) => ({
      ...view,
      children: view.children.length ? filterDocumentViews(view.children) : [],
    }));
}

export function hasDatabaseViewChild(view: View): boolean {
  return (
    [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.List, ViewLayout.Gallery].includes(
      view.layout
    ) ||
    (view.layout === ViewLayout.Document && view.children.some((child) => hasDatabaseViewChild(child)))
  );
}

export function searchViews(views: View[], searchValue: string): View[] {
  if (!searchValue.trim()) {
    return views;
  }

  const searchLower = searchValue.toLowerCase();

  return views
    .filter((view) => view.layout === ViewLayout.Document)
    .reduce<View[]>((acc, view) => {
      const currentMatches = view.name.toLowerCase().includes(searchLower);

      const matchingChildren = view.children.length ? searchViews(view.children, searchValue) : [];

      if (currentMatches || matchingChildren.length > 0) {
        acc.push({
          ...view,
          children: matchingChildren,
        });
      }

      return acc;
    }, []);
}

export function searchDatabaseViews(views: View[], searchValue: string): View[] {
  if (!searchValue.trim()) {
    return views;
  }

  const searchLower = searchValue.toLowerCase();

  return views.reduce<View[]>((acc, view) => {
    const currentMatches = view.name.toLowerCase().includes(searchLower);

    const matchingChildren = view.children.length ? searchDatabaseViews(view.children, searchValue) : [];

    if (currentMatches || matchingChildren.length > 0) {
      acc.push({
        ...view,
        children: matchingChildren,
      });
    }

    return acc;
  }, []);
}
