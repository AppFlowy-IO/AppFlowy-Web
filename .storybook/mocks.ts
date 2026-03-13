/**
 * Shared mock values for Storybook stories
 *
 * This file contains common mock context values to avoid duplication across story files.
 * Import and use these mocks in your stories instead of creating new ones.
 *
 * Context hierarchy (for reference):
 *   AFConfigContext        (root — login state, currentUser)
 *   └─ AuthInternalContext (workspace-level auth state)
 *       └─ AppSyncContext        (eventEmitter, awareness)
 *       └─ AppNavigationContext  (viewId, breadcrumbs, rendered)
 *       └─ AppOutlineContext     (outline tree, favorites, recents)
 *       └─ AppOperationsContext  (CRUD callbacks, publish, history)
 */

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { AppNavigationContextType } from '@/components/app/contexts/AppNavigationContext';
import { AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContextType } from '@/components/app/contexts/AppOutlineContext';
import { AppSyncContextType } from '@/components/app/contexts/AppSyncContext';
import { AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

// ─── AFConfigContext mocks ───────────────────────────────────────────────────

/**
 * Mock AFConfig context value
 * Used by components that need authentication context
 */
export const mockAFConfigValue = {
  isAuthenticated: true,
  currentUser: {
    email: 'storybook@example.com',
    name: 'Storybook User',
    uid: 'storybook-uid',
    avatar: null,
    uuid: 'storybook-uuid',
    latestWorkspaceId: 'storybook-workspace-id',
  },
  updateCurrentUser: async () => {
    // Mock implementation
  },
  openLoginModal: () => {
    // Mock implementation
  },
};

/**
 * Minimal mock AFConfig
 */
export const mockAFConfigValueMinimal = {
  isAuthenticated: true,
  currentUser: {
    email: 'storybook@example.com',
    name: 'Storybook User',
    uid: 'storybook-uid',
    avatar: null,
    uuid: 'storybook-uuid',
    latestWorkspaceId: 'storybook-workspace-id',
  },
  updateCurrentUser: async () => {
    // Mock implementation
  },
  openLoginModal: () => {
    // Mock implementation
  },
};

// ─── Split context mocks ─────────────────────────────────────────────────────

/** AuthInternalContext mock — workspace-level auth state. */
export const mockAuthInternalValue: AuthInternalContextType = {
  userWorkspaceInfo: {
    userId: 'storybook-uid',
    selectedWorkspace: {
      id: 'storybook-workspace-id',
      name: 'Storybook Workspace',
      icon: '',
      memberCount: 1,
      databaseStorageId: '',
      createdAt: new Date().toISOString(),
      owner: {
        uid: 1,
        name: 'Storybook User',
      },
    },
    workspaces: [
      {
        id: 'storybook-workspace-id',
        name: 'Storybook Workspace',
        icon: '',
        memberCount: 1,
        databaseStorageId: '',
        createdAt: new Date().toISOString(),
        owner: {
          uid: 1,
          name: 'Storybook User',
        },
      },
    ],
  },
  currentWorkspaceId: 'storybook-workspace-id',
  isAuthenticated: true,
  onChangeWorkspace: async () => {},
};

/** AppNavigationContext mock — page navigation state. */
export const mockNavigationValue: AppNavigationContextType = {
  rendered: true,
  appendBreadcrumb: () => {},
  onRendered: () => {},
  openPageModal: () => {},
};

/** AppOutlineContext mock — sidebar outline tree. */
export const mockOutlineValue: AppOutlineContextType = {
  outline: [],
  loadViews: async () => [],
};

/** AppOperationsContext mock — CRUD callbacks. */
export const mockOperationsValue = {
  toView: async () => {},
  loadViewMeta: async () => {
    throw new Error('Not implemented in story');
  },
  loadView: async () => {
    throw new Error('Not implemented in story');
  },
  updatePage: async () => {},
  addPage: async () => 'test-page-id',
  deletePage: async () => {},
  setWordCount: () => {},
  uploadFile: async () => {
    throw new Error('Not implemented in story');
  },
  getSubscriptions: async () => {
    return [
      {
        plan: SubscriptionPlan.Free,
        currency: 'USD',
        recurring_interval: SubscriptionInterval.Month,
        price_cents: 0,
      },
    ];
  },
} as unknown as AppOperationsContextType;

/** AppSyncContext mock — event bus and awareness. */
export const mockSyncValue: AppSyncContextType = {
  eventEmitter: undefined,
  awarenessMap: {},
};

// ─── Legacy combined mock (for backward compat in individual stories) ────────

/**
 * Combined mock that merges all split-context fields into a flat object.
 * Useful for stories that provide contexts manually (e.g. UpgradePlan.stories.tsx).
 *
 * @deprecated Prefer the individual split mocks above. This exists only to
 * ease migration of stories that previously used the removed AppContext.
 */
export const mockAppContextValue = {
  ...mockAuthInternalValue,
  ...mockNavigationValue,
  ...mockOutlineValue,
  ...mockOperationsValue,
  ...mockSyncValue,
};
