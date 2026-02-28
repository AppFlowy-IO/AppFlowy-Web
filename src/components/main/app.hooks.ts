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

export const AFConfigContext = createContext<
  | {
    isAuthenticated: boolean;
    currentUser?: User;
    updateCurrentUser: (user: User) => Promise<void>;
    openLoginModal: (redirectTo?: string) => void;
  }
  | undefined
>(undefined);

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
