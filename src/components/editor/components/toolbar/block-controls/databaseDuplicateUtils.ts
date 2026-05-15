import { BlockType, View, ViewLayout } from '@/application/types';

const DATABASE_BLOCK_TYPES = new Set([
  BlockType.GridBlock,
  BlockType.BoardBlock,
  BlockType.CalendarBlock,
  BlockType.ChartBlock,
]);

export function isDatabaseBlockType(type: BlockType | undefined): boolean {
  return type ? DATABASE_BLOCK_TYPES.has(type) : false;
}

export function getDatabaseLayoutFromBlockType(type: BlockType): ViewLayout | undefined {
  switch (type) {
    case BlockType.GridBlock:
      return ViewLayout.Grid;
    case BlockType.BoardBlock:
      return ViewLayout.Board;
    case BlockType.CalendarBlock:
      return ViewLayout.Calendar;
    case BlockType.ChartBlock:
      return ViewLayout.Chart;
    default:
      return undefined;
  }
}

export function findDuplicatedContainerChild(params: {
  beforeChildren?: View[];
  afterChildren?: View[];
  sourceContainerId: string;
  duplicatedName?: string;
}): View | undefined {
  const allAfterChildren = (params.afterChildren ?? []).filter(
    (child) => child.view_id !== params.sourceContainerId
  );

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
