import { createContext, useContext } from 'react';

import { UserWorkspaceInfo } from '@/application/types';

// Internal context for authentication layer
// This context is only used within the app provider layers
export interface AuthInternalContextType {
  userWorkspaceInfo?: UserWorkspaceInfo;
  currentWorkspaceId?: string;
  isAuthenticated: boolean;
  enablePageHistory?: boolean;
  onChangeWorkspace: (workspaceId: string) => Promise<void>;
}

export const AuthInternalContext = createContext<AuthInternalContextType | null>(null);

// Hook to access auth internal context
export function useAuthInternal() {
  const context = useContext(AuthInternalContext);
  
  if (!context) {
    throw new Error('useAuthInternal must be used within an AuthInternalProvider');
  }
  
  return context;
}