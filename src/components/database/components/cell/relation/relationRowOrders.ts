interface RelationRowOrder {
  id: string;
  is_deleted?: boolean;
}

export function getLiveRelationRowIds(rowOrders: readonly RelationRowOrder[]) {
  return rowOrders.filter((row) => !row.is_deleted).map((row) => row.id);
}
