import { createContext, useContext } from 'react';

import { AFCloudConfig } from '@/application/services/services.type';
import { User } from '@/application/types';
import { getConfigValue } from '@/utils/runtime-config';

const baseURL = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
const gotrueURL = getConfigValue('APPFLOWY_GOTRUE_BASE_URL', 'https://test.appflowy.cloud/gotrue');

export const defaultConfig: AFCloudConfig = {
  baseURL,
  gotrueURL,
  wsURL: '', // Legacy field - not used, keeping for backward compatibility
};

/**
 * Root authentication context — provided at the app root level.
 *
 * **Provider:** `withAppWrapper` / `AppConfig` (outermost provider, wraps all routes)
 *
 * Available on ALL routes, including login, landing, publish, and invitation pages.
 * Components that may render outside this provider should use the `*Optional` hook
 * variants (e.g. `useCurrentUserOptional`, `useIsAuthenticatedOptional`).
 *
 * **Hooks (strict — throw if no provider):**
 * - `useAppConfig()` — full context
 * - `useCurrentUser()` — the logged-in User object
 *
 * **Hooks (optional — safe outside provider):**
 * - `useCurrentUserOptional()` — User or undefined
 * - `useIsAuthenticatedOptional()` — boolean, defaults false
 * - `useOpenLoginModalOptional()` — callback or undefined
 */
export const AFConfigContext = createContext<
  | {
    /** Whether the user is currently authenticated. */
    isAuthenticated: boolean;
    /** The logged-in user, or undefined if not yet loaded. */
    currentUser?: User;
    /** Update the current user's profile (name, avatar, etc.). */
    updateCurrentUser: (user: User) => Promise<void>;
    /** Open the login modal. Pass redirectTo to return to a specific URL after login. */
    openLoginModal: (redirectTo?: string) => void;
  }
  | undefined
>(undefined);

/** Returns the full AFConfigContext. Throws if used outside provider. */
export function useAppConfig() {
  const context = useContext(AFConfigContext);

  if (!context) {
    throw new Error('useAppConfig must be used within a AFConfigContext');
  }

  return {
    isAuthenticated: context.isAuthenticated,
    currentUser: context.currentUser,
    updateCurrentUser: context.updateCurrentUser,
    openLoginModal: context.openLoginModal,
  };
}

/** Returns the current user. Throws if used outside AFConfigContext provider. */
export function useCurrentUser() {
  const context = useContext(AFConfigContext);

  if (!context) {
    throw new Error('useCurrentUser must be used within a AFConfigContext');
  }

  return context.currentUser;
}

/**
 * Optional variant of useCurrentUser that returns undefined
 * instead of throwing when used outside AFConfigContext.
 */
export function useCurrentUserOptional(): User | undefined {
  const context = useContext(AFConfigContext);

  return context?.currentUser;
}

/**
 * Returns whether the user is authenticated.
 * Returns false when AFConfigContext provider is absent (e.g. publish pages).
 */
export function useIsAuthenticatedOptional(): boolean {
  const context = useContext(AFConfigContext);

  return context?.isAuthenticated ?? false;
}

/**
 * Returns the openLoginModal callback, or undefined when AFConfigContext provider is absent.
 */
export function useOpenLoginModalOptional(): ((redirectTo?: string) => void) | undefined {
  const context = useContext(AFConfigContext);

  return context?.openLoginModal;
}
