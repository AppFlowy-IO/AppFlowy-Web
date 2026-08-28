import { View } from '@/application/types';

export { getDatabaseLayoutFromBlockType, isDatabaseBlockType } from '@/application/database-block';

export async function loadDatabaseDuplicateSourceViews(params: {
  sourceViewIds: string[];
  firstSourceView: View;
  loadViewMeta: (viewId: string) => Promise<View | null>;
}): Promise<Array<View | null>> {
  return Promise.all(
    params.sourceViewIds.map((viewId, index) => {
      // The first view has already been loaded to identify the duplication
      // path. Preserve that authoritative layout instead of reloading it and
      // falling back to the shared GridBlock type if the reload fails.
      if (index === 0) return params.firstSourceView;

      return Promise.resolve()
        .then(() => params.loadViewMeta(viewId))
        .catch(() => null);
    })
  );
}

export function findDuplicatedContainerChild(params: {
  beforeChildren?: View[];
  afterChildren?: View[];
  sourceContainerId: string;
  duplicatedName?: string;
}): View | undefined {
  const allAfterChildren = (params.afterChildren ?? []).filter((child) => child.view_id !== params.sourceContainerId);

  const beforeIds = new Set((params.beforeChildren ?? []).map((child) => child.view_id));
  const addedChildren = allAfterChildren.filter((child) => !beforeIds.has(child.view_id));

  if (addedChildren.length === 0) {
    return undefined;
  }

  if (params.duplicatedName) {
    const nameMatch = addedChildren.find((child) => child.name === params.duplicatedName);

    if (nameMatch) {
      return nameMatch;
    }
  }

  return addedChildren[0];
}
