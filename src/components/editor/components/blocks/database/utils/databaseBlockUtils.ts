import { DatabaseNodeData } from '@/application/types';

/**
 * Utility functions for database block view_ids operations
 * with backward compatibility for legacy view_id field.
 */

/**
 * Get view IDs from database node data with backward compatibility.
 * Checks for new view_ids array first, then falls back to legacy view_id.
 */
export function getViewIds(data: DatabaseNodeData): string[] {
  // Check for new view_ids array first
  if (data.view_ids && Array.isArray(data.view_ids) && data.view_ids.length > 0) {
    return data.view_ids;
  }

  // Fallback to legacy single view_id
  if (data.view_id) {
    return [data.view_id];
  }

  return [];
}

/**
 * Get the primary (first) view ID from database node data.
 */
export function getPrimaryViewId(data: DatabaseNodeData): string | undefined {
  const viewIds = getViewIds(data);

  return viewIds.length > 0 ? viewIds[0] : undefined;
}

/**
 * Check if database node data has any view IDs.
 */
export function hasViewIds(data: DatabaseNodeData): boolean {
  return getViewIds(data).length > 0;
}

/**
 * Create database node data with view_ids array format.
 * Automatically deduplicates view IDs while preserving order.
 */
export function createDatabaseNodeData(params: {
  parentId: string;
  viewIds: string[];
  databaseId?: string;
}): DatabaseNodeData {
  // Deduplicate view IDs while preserving order
  const uniqueViewIds = [...new Set(params.viewIds)];

  return {
    parent_id: params.parentId,
    view_ids: uniqueViewIds,
    database_id: params.databaseId,
  };
}

/**
 * Add a view ID to existing database node data (returns new data object).
 */
export function addViewId(data: DatabaseNodeData, viewId: string): DatabaseNodeData {
  const currentIds = [...getViewIds(data)];

  if (!currentIds.includes(viewId)) {
    currentIds.push(viewId);
  }

  return {
    ...data,
    view_ids: currentIds,
  };
}

/**
 * Remove a view ID from existing database node data (returns new data object).
 */
export function removeViewId(data: DatabaseNodeData, viewId: string): DatabaseNodeData {
  const currentIds = getViewIds(data).filter(id => id !== viewId);

  return {
    ...data,
    view_ids: currentIds,
  };
}

/**
 * Parse database node data from JSON string with backward compatibility.
 */
export function parseDatabaseNodeData(jsonString: string): DatabaseNodeData {
  try {
    const data = JSON.parse(jsonString) as DatabaseNodeData;

    return data;
  } catch {
    return {};
  }
}

/**
 * Serialize database node data to JSON string.
 */
export function serializeDatabaseNodeData(data: DatabaseNodeData): string {
  return JSON.stringify(data);
}
