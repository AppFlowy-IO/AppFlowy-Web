import { AccessLevel, View, ViewLayout } from '@/application/types';

export function filterViews (views: View[], keyword: string): View[] {
  const filterAndFlatten = (views: View[]): View[] => {
    let result: View[] = [];

    for (const view of views) {
      if (view.name.toLowerCase().includes(keyword.toLowerCase())) {
        result.push(view);
      }

      if (view.children) {
        const filteredChildren = filterAndFlatten(view.children);

        result = result.concat(filteredChildren);
      }
    }

    return result;
  };

  return filterAndFlatten(views);
}

export function findViewByLayout (views: View[], layout: ViewLayout[]): View | null {
  for (const view of views) {
    if (layout.includes(view.layout) && !view.extra?.is_space) {
      return view;
    }

    if (view.children) {
      const result = findViewByLayout(view.children, layout);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function filterOutViewsByLayout (views: View[], layout: ViewLayout): View[] {
  const filterOut = (views: View[]): View[] => {
    const result: View[] = [];

    for (const view of views) {
      if (view.layout !== layout) {
        const newView = { ...view };

        newView.children = filterOut(view.children);
        result.push(newView);
      }

    }

    return result;
  };

  return filterOut(views);
}

export function filterViewsByCondition (views: View[], condition: (view: View) => boolean): View[] {
  const filter = (views: View[]): View[] => {
    let result: View[] = [];

    for (const view of views) {
      if (condition(view)) {
        result.push(view);
      }

      if (view.children) {
        const filteredChildren = filter(view.children);

        result = result.concat(filteredChildren);
      }
    }

    return result;
  };

  return filter(views);
}

export function filterOutByCondition (views: View[], condition: (view: View) => {
  remove: boolean;
}): View[] {
  const filterOut = (views: View[]): View[] => {
    const result: View[] = [];

    for (const view of views) {
      const { remove } = condition(view);

      if (remove) {
        continue;
      }

      const newView = { ...view };

      newView.children = filterOut(view.children);
      result.push(newView);
    }

    return result;
  };

  return filterOut(views);
}

export function findAncestors (data: View[], targetId: string, currentPath: View[] = []): View[] | null {
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

export function findView (data: View[], targetId: string): View | null {
  for (const item of data) {
    if (item.view_id === targetId) {
      return item;
    }

    if (item.children && item.children.length > 0) {
      const result = findView(item.children, targetId);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function findParentView (data: View[], targetId: string): View | null {
  for (const item of data) {
    if (item.children?.some(c => c.view_id === targetId)) {
      return item;
    }

    if (item.children && item.children.length > 0) {
      const result = findParentView(item.children, targetId);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function flattenViews (views: View[]): View[] {
  const result: View[] = [];

  for (const view of views) {
    result.push(view);

    if (view.children) {
      result.push(...flattenViews(view.children));
    }
  }

  return result;
}

const LEGACY_EXPAND_KEY = 'outline_expanded';

const expandStorageKey = (workspaceId?: string) =>
  workspaceId ? `${LEGACY_EXPAND_KEY}_${workspaceId}` : LEGACY_EXPAND_KEY;

export function getOutlineExpands (workspaceId?: string) {
  // Expand state is scoped per workspace: a single global entry meant that opening one
  // workspace validated (and pruned) the restored ids of every other workspace, so a
  // switch always collapsed the target workspace's spaces. Fall back to the legacy global
  // entry so existing users keep their state; the next write migrates it to the scoped key.
  const expandView =
    localStorage.getItem(expandStorageKey(workspaceId)) ??
    (workspaceId ? localStorage.getItem(LEGACY_EXPAND_KEY) : null);

  try {
    return JSON.parse(expandView || '{}');
  } catch (e) {
    return {};
  }
}

export function setOutlineExpands (viewId: string, isExpanded: boolean, workspaceId?: string) {
  const expands = getOutlineExpands(workspaceId);

  if (isExpanded) {
    expands[viewId] = true;
  } else {
    delete expands[viewId];
  }

  localStorage.setItem(expandStorageKey(workspaceId), JSON.stringify(expands));
}

/**
 * Return the chain of ancestor view ids for `targetId` within `data`, or null when the view
 * is not in the tree. Used to expand the ancestors of a view that is already present in the
 * outline (e.g. after a workspace switch), where no navigation hydration fetch is needed.
 */
export function findViewAncestorIds (data: View[], targetId: string, trail: string[] = []): string[] | null {
  for (const item of data) {
    if (item.view_id === targetId) {
      return trail;
    }

    if (item.children) {
      const result = findViewAncestorIds(item.children, targetId, [...trail, item.view_id]);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

export function findShareWithMeSpace (views: View[]): View | null {
  for (const view of views) {
    if (view.extra?.is_space && view.extra?.is_hidden_space) {
      return view;
    }
  }

  return null;
}

export function findViewInShareWithMe (views: View[], targetViewId: string): View | null {
  const shareWithMeSpace = findShareWithMeSpace(views);

  if (!shareWithMeSpace?.children) {
    return null;
  }

  return findView(shareWithMeSpace.children, targetViewId);
}

/**
 * Resolve the effective access level for a view shared with the current user.
 *
 * A shared private space carries its `access_level` on the space node; child
 * pages inside it have no explicit level of their own. Walk the ancestor chain
 * inside the hidden "Shared with me" space and return the nearest ancestor that
 * declares an `access_level` (the target view itself first), so an explicit
 * child re-share overrides the inherited space access.
 *
 * Returns `undefined` when the view is not part of the "Shared with me" space
 * (e.g. a view the user owns), in which case no shared access restriction
 * applies.
 */
export function findSharedAccessLevel (views: View[], targetViewId: string): AccessLevel | undefined {
  const shareWithMeSpace = findShareWithMeSpace(views);

  if (!shareWithMeSpace?.children) {
    return undefined;
  }

  const path = findAncestors(shareWithMeSpace.children, targetViewId);

  if (!path) {
    return undefined;
  }

  for (let i = path.length - 1; i >= 0; i--) {
    const accessLevel = path[i].access_level;

    if (accessLevel !== undefined) {
      return accessLevel;
    }
  }

  return undefined;
}
