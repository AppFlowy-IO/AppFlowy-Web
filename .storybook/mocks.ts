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

import { PricingCatalog, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
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
  isOfficialHosted: true,
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

/** Pricing catalog mock — mirrors `GET /billing/api/v1/pricing` on the official cloud. */
export const mockPricingCatalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    {
      id: 'free',
      kind: 'workspace_plan',
      name: 'Free',
      description: 'For individuals up to 2 members to organize everything',
      prices: [],
      features: [
        { key: 'members', label: 'Up to 2 members', value: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' } },
        { key: 'storage', label: '5 GB storage', value: { kind: 'quantity', amount: 5, unit: 'gb', display: '5 GB' } },
        { key: 'realtime_collaboration', label: 'Real-time collaboration', value: { kind: 'included', display: 'yes' } },
        {
          key: 'ai_responses',
          label: '10 lifetime AI responses',
          value: { kind: 'quantity', amount: 10, unit: 'responses_lifetime', display: '10 lifetime' },
        },
        {
          key: 'ai_images',
          label: '2 lifetime AI images',
          value: { kind: 'quantity', amount: 2, unit: 'images_lifetime', display: '2 lifetime' },
        },
        { key: 'file_uploads', label: 'File uploads up to 7 MB', value: { kind: 'quantity', amount: 7, unit: 'mb', display: 'Up to 7 MB' } },
        { key: 'version_history', label: '7 days version history', value: { kind: 'quantity', amount: 7, unit: 'days', display: '7 days' } },
      ],
    },
    {
      id: 'pro',
      kind: 'workspace_plan',
      name: 'Pro',
      description: 'For small teams to manage projects and team knowledge',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1250 },
        { interval: SubscriptionInterval.Year, price_cents: 12000 },
      ],
      features: [
        { key: 'storage', label: 'Unlimited storage', value: { kind: 'unlimited', display: 'Unlimited' } },
        { key: 'members', label: 'Up to 10 workspace members', value: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' } },
        { key: 'guests', label: 'Up to 10 guest editors', value: { kind: 'quantity', amount: 10, unit: 'guests', display: 'Up to 10' } },
        { key: 'ai_responses', label: 'Unlimited AI responses', value: { kind: 'unlimited', display: 'Unlimited' } },
        {
          key: 'ai_images',
          label: '10 AI images per month',
          value: { kind: 'quantity', amount: 10, unit: 'images_per_month', display: '10 images per month' },
        },
        { key: 'file_uploads', label: 'Unlimited file upload size', value: { kind: 'unlimited', display: 'Unlimited' } },
        { key: 'version_history', label: '30 days version history', value: { kind: 'quantity', amount: 30, unit: 'days', display: '30 days' } },
        { key: 'custom_namespace', label: 'Custom namespace for your published site', value: { kind: 'included', display: 'yes' } },
      ],
    },
    {
      id: 'ai_max',
      kind: 'workspace_add_on',
      name: 'AI Max',
      description: 'Unlimited AI responses, and choose from latest advanced AI models',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1000 },
        { interval: SubscriptionInterval.Year, price_cents: 9600 },
      ],
      features: [
        { key: 'ai_responses', label: 'Unlimited AI responses', value: { kind: 'unlimited', display: 'Unlimited' } },
        { key: 'ai_models', label: 'Choose from the latest advanced AI models', value: { kind: 'included', display: 'yes' } },
        {
          key: 'ai_images',
          label: '50 AI images per month',
          value: { kind: 'quantity', amount: 50, unit: 'images_per_month', display: '50 images per month' },
        },
        { key: 'file_uploads', label: 'Unlimited file upload size', value: { kind: 'unlimited', display: 'Unlimited' } },
      ],
    },
    {
      id: 'vault_workspace',
      kind: 'account_add_on',
      name: 'Vault Workspace',
      description: 'Private and offline— AI runs locally, no data transfer',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 750 },
        { interval: SubscriptionInterval.Year, price_cents: 7200 },
      ],
      features: [{ key: 'vault', label: 'Privacy Vault for your workspace', value: { kind: 'included', display: 'yes' } }],
    },
  ],
  comparison: [
    {
      key: 'members',
      label: 'Members',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' },
        pro: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' },
      },
    },
    {
      key: 'storage',
      label: 'Storage',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 5, unit: 'gb', display: '5 GB' },
        pro: { kind: 'unlimited', display: 'Unlimited' },
      },
    },
    {
      key: 'guests',
      label: 'Guest editors',
      tooltip: 'Collaborate on specific pages with non-members',
      values: {
        free: { kind: 'excluded', display: 'no' },
        pro: { kind: 'quantity', amount: 10, unit: 'guests', display: 'Up to 10' },
      },
    },
  ],
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
  getPricingCatalog: async () => mockPricingCatalog,
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
