/**
 * Shared mock values for Storybook stories
 *
 * This file contains common mock context values to avoid duplication across story files.
 * Import and use these mocks in your stories instead of creating new ones.
 */

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';

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

/**
 * Mock App context value
 * Used by components that need workspace and app state
 */
export const mockAppContextValue = {
  userWorkspaceInfo: {
    selectedWorkspace: {
      id: 'storybook-workspace-id',
      name: 'Storybook Workspace',
      owner: {
        uid: 'storybook-uid',
      },
    },
    workspaces: [
      {
        id: 'storybook-workspace-id',
        name: 'Storybook Workspace',
        owner: {
          uid: 'storybook-uid',
        },
      },
    ],
  },
  currentWorkspaceId: 'storybook-workspace-id',
  outline: [],
  rendered: true,
  toView: async () => {},
  loadViewMeta: async () => {
    throw new Error('Not implemented in story');
  },
  loadView: async () => {
    throw new Error('Not implemented in story');
  },
  createRowDoc: async () => {
    throw new Error('Not implemented in story');
  },
  appendBreadcrumb: () => {},
  onRendered: () => {},
  updatePage: async () => {},
  addPage: async () => 'test-page-id',
  deletePage: async () => {},
  openPageModal: () => {},
  loadViews: async () => [],
  setWordCount: () => {},
  uploadFile: async () => {
    throw new Error('Not implemented in story');
  },
  eventEmitter: undefined,
  awarenessMap: {},
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
};
