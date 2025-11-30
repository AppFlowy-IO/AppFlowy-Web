import { View, YDoc } from '@/application/types';

/**
 * Configuration for database loading behavior
 */
export interface DatabaseLoadingConfig {
  viewId: string;
  allowedViewIds?: string[];
  loadView?: (viewId: string) => Promise<YDoc | null>;
  loadViewMeta?: (viewId: string, callback?: (meta: View | null) => void) => Promise<View | null>;
}

/**
 * Strategy interface for loading database views
 * This allows different loading behaviors for embedded vs standalone databases
 */
export interface DatabaseLoadingStrategy {
  /**
   * Whether meta loading errors should trigger notFound state
   */
  shouldSetNotFoundOnMetaError: () => boolean;

  /**
   * Whether to skip meta loading for a given view ID
   */
  shouldSkipMetaLoad: (id: string) => boolean;

  /**
   * Get the visible view IDs from meta or fallback
   */
  getVisibleViewIds: (meta: View | null) => string[];

  /**
   * Get the database name from meta or fallback
   */
  getDatabaseName: (meta: View | null) => string;
}

/**
 * Strategy for embedded database blocks
 * - Uses allowedViewIds from block data
 * - Doesn't require meta for functioning
 * - Gracefully handles meta loading failures
 */
export const createEmbeddedDatabaseStrategy = (config: DatabaseLoadingConfig): DatabaseLoadingStrategy => {
  const { viewId, allowedViewIds = [] } = config;

  return {
    shouldSetNotFoundOnMetaError: () => false,

    shouldSkipMetaLoad: (id: string) => {
      // Skip meta load for non-base views (embedded views)
      return id !== viewId;
    },

    getVisibleViewIds: () => {
      return allowedViewIds;
    },

    getDatabaseName: (meta: View | null) => {
      return meta?.name ?? '';
    },
  };
};

/**
 * Strategy for standalone database views
 * - Loads view IDs from meta.children
 * - Requires meta for proper functioning
 * - Sets notFound on meta loading failure
 */
export const createStandaloneDatabaseStrategy = (config: DatabaseLoadingConfig): DatabaseLoadingStrategy => {
  const { viewId } = config;

  return {
    shouldSetNotFoundOnMetaError: () => true,

    shouldSkipMetaLoad: () => false,

    getVisibleViewIds: (meta: View | null) => {
      if (!meta) return [viewId];

      const viewIds = meta.children.map((v) => v.view_id) || [];

      viewIds.unshift(meta.view_id);

      return viewIds;
    },

    getDatabaseName: (meta: View | null) => {
      return meta?.name ?? '';
    },
  };
};

/**
 * Factory function to create the appropriate strategy based on config
 */
export const createLoadingStrategy = (config: DatabaseLoadingConfig): DatabaseLoadingStrategy => {
  const hasAllowedViewIds = config.allowedViewIds && config.allowedViewIds.length > 0;

  if (hasAllowedViewIds) {
    return createEmbeddedDatabaseStrategy(config);
  }

  return createStandaloneDatabaseStrategy(config);
};

/**
 * Check if the database is embedded (has allowedViewIds)
 */
export const isEmbeddedDatabase = (allowedViewIds?: string[]): boolean => {
  return !!(allowedViewIds && allowedViewIds.length > 0);
};
