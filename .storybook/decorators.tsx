/**
 * Shared decorators for Storybook stories
 *
 * This file contains reusable decorator functions to avoid duplication across story files.
 * Import and use these decorators in your stories.
 *
 * Context hierarchy provided by the decorators:
 *   AFConfigContext           (root — login state, currentUser)
 *   └─ AuthInternalContext    (workspace-level auth)
 *       └─ AppNavigationContext
 *       └─ AppOutlineContext
 *       └─ AppOperationsContext
 *       └─ AppSyncContext
 */

import React, { useEffect, useRef } from 'react';

import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { AppSyncContext } from '@/components/app/contexts/AppSyncContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import {
  mockAFConfigValue,
  mockAFConfigValueMinimal,
  mockAuthInternalValue,
  mockNavigationValue,
  mockOutlineValue,
  mockOperationsValue,
  mockSyncValue,
} from './mocks';

/**
 * Hostname mocking utilities
 */
declare global {
  interface Window {
    __APP_CONFIG__?: {
      APPFLOWY_BASE_URL?: string;
      APPFLOWY_GOTRUE_BASE_URL?: string;
      APPFLOWY_WS_BASE_URL?: string;
    };
  }
}

type CleanupFn = () => void;

const normalizeHostnameToBaseUrl = (hostname: string): string => {
  const trimmed = hostname.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

export const mockHostname = (hostname: string): CleanupFn => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const previousConfig = window.__APP_CONFIG__ ? { ...window.__APP_CONFIG__ } : undefined;
  const formattedHostname = hostname?.trim();

  if (!formattedHostname) {
    delete window.__APP_CONFIG__;
    return () => {
      if (previousConfig) {
        window.__APP_CONFIG__ = previousConfig;
      }
    };
  }

  const baseUrl = normalizeHostnameToBaseUrl(formattedHostname);

  window.__APP_CONFIG__ = {
    ...(window.__APP_CONFIG__ ?? {}),
    APPFLOWY_BASE_URL: baseUrl,
  };

  return () => {
    if (previousConfig) {
      window.__APP_CONFIG__ = previousConfig;
    } else {
      delete window.__APP_CONFIG__;
    }
  };
};

export const useHostnameMock = (hostname: string) => {
  const cleanupRef = useRef<CleanupFn | null>(null);
  const appliedHostnameRef = useRef<string>();

  if (appliedHostnameRef.current !== hostname) {
    cleanupRef.current?.();
    cleanupRef.current = mockHostname(hostname);
    appliedHostnameRef.current = hostname;
  }

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      appliedHostnameRef.current = undefined;
    };
  }, []);
};

/**
 * Internal helper that wraps children in all split app context providers.
 * Provides: AuthInternalContext, AppNavigationContext, AppOutlineContext,
 *           AppOperationsContext, AppSyncContext.
 */
const AppContextProviders = ({ children }: { children: React.ReactNode }) => (
  <AuthInternalContext.Provider value={mockAuthInternalValue}>
    <AppNavigationContext.Provider value={mockNavigationValue}>
      <AppOutlineContext.Provider value={mockOutlineValue}>
        <AppOperationsContext.Provider value={mockOperationsValue}>
          <AppSyncContext.Provider value={mockSyncValue}>
            {children}
          </AppSyncContext.Provider>
        </AppOperationsContext.Provider>
      </AppOutlineContext.Provider>
    </AppNavigationContext.Provider>
  </AuthInternalContext.Provider>
);

/**
 * Decorator that provides AFConfigContext with mock values
 * Use this for components that need authentication context
 */
export const withAFConfig = (Story: React.ComponentType) => (
  <AFConfigContext.Provider value={mockAFConfigValue}>
    <Story />
  </AFConfigContext.Provider>
);

/**
 * Decorator that provides AFConfigContext with minimal mock values
 * Use this for components that need auth context
 */
export const withAFConfigMinimal = (Story: React.ComponentType) => (
  <AFConfigContext.Provider value={mockAFConfigValueMinimal}>
    <Story />
  </AFConfigContext.Provider>
);

/**
 * Decorator that provides all split app contexts with mock values.
 * Use this for components that need workspace and app state.
 *
 * Provides: AuthInternalContext, AppNavigationContext, AppOutlineContext,
 *           AppOperationsContext, AppSyncContext.
 */
export const withAppContext = (Story: React.ComponentType) => (
  <AppContextProviders>
    <Story />
  </AppContextProviders>
);

/**
 * Decorator that provides both AFConfig and all split app contexts.
 * Use this for components that need both authentication and app state.
 */
export const withContexts = (Story: React.ComponentType) => (
  <AFConfigContext.Provider value={mockAFConfigValue}>
    <AppContextProviders>
      <Story />
    </AppContextProviders>
  </AFConfigContext.Provider>
);

/**
 * Decorator that provides both AFConfig (minimal) and all split app contexts.
 */
export const withContextsMinimal = (Story: React.ComponentType) => (
  <AFConfigContext.Provider value={mockAFConfigValueMinimal}>
    <AppContextProviders>
      <Story />
    </AppContextProviders>
  </AFConfigContext.Provider>
);

/**
 * Higher-order decorator for hostname mocking
 * Use this for components that behave differently based on hostname (official vs self-hosted)
 *
 * @example
 * decorators: [withHostnameMocking()]
 */
export const withHostnameMocking = () => {
  return (Story: React.ComponentType, context: { args: { hostname?: string } }) => {
    const hostname = context.args.hostname || 'beta.appflowy.cloud';

    useHostnameMock(hostname);

    return <Story />;
  };
};

/**
 * Combined decorator: hostname mocking + both contexts
 * Common pattern for components that need contexts and hostname mocking
 *
 * @param options.padding - Add padding around the story (default: '20px')
 * @param options.maxWidth - Maximum width of the story container
 * @param options.minimalAFConfig - Use minimal AFConfig
 */
export const withHostnameAndContexts = (options?: {
  padding?: string;
  maxWidth?: string;
  minimalAFConfig?: boolean;
}) => {
  const { padding = '20px', maxWidth, minimalAFConfig = false } = options || {};

  return (Story: React.ComponentType, context: { args: { hostname?: string } }) => {
    const hostname = context.args.hostname || 'beta.appflowy.cloud';

    useHostnameMock(hostname);

    const afConfigValue = minimalAFConfig ? mockAFConfigValueMinimal : mockAFConfigValue;

    return (
      <AFConfigContext.Provider value={afConfigValue}>
        <AppContextProviders>
          <div style={{ padding, ...(maxWidth && { maxWidth }) }}>
            <Story />
          </div>
        </AppContextProviders>
      </AFConfigContext.Provider>
    );
  };
};

/**
 * Decorator that adds a padded container
 * Use this for consistent spacing around components
 */
export const withPadding = (padding = '20px') => {
  return (Story: React.ComponentType) => (
    <div style={{ padding }}>
      <Story />
    </div>
  );
};

/**
 * Decorator that adds a padded container with max width
 * Use this for components that should be constrained
 */
export const withContainer = (options?: { padding?: string; maxWidth?: string }) => {
  const { padding = '20px', maxWidth = '600px' } = options || {};

  return (Story: React.ComponentType) => (
    <div style={{ padding, maxWidth }}>
      <Story />
    </div>
  );
};
