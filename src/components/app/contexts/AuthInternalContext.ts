import { createContext, useContext } from 'react';

import { UserWorkspaceInfo } from '@/application/types';

/**
 * Authentication layer context.
 *
 * **Provider:** `AppAuthLayer` (outermost app layer)
 *
 * **Provider hierarchy:**
 * ```
 * AFConfigContext (root)            ← login state, currentUser
 *   └─ AppAuthLayer                ← provides THIS context
 *       └─ ConditionalWorkspaceLayers
 *           └─ AppSyncLayer        ← websocket sync
 *               └─ AppBusinessLayer ← provides Navigation/Outline/Operations/Sync contexts
 * ```
 *
 * Contains workspace-level auth state derived from `AFConfigContext`.
 * Available as soon as AppProvider mounts; does NOT depend on WebSocket
 * being connected.
 *
 * **Hooks:** `useCurrentWorkspaceId`, `useCurrentWorkspaceIdOptional`,
 *            `useUserWorkspaceInfo`, `usePageHistoryEnabled`
 */
export interface AuthInternalContextType {
  /** All workspace info for the current user, including workspace list and selected workspace. */
  userWorkspaceInfo?: UserWorkspaceInfo;
  /** The ID of the currently active workspace. Derived from `userWorkspaceInfo.selectedWorkspace.id`. */
  currentWorkspaceId?: string;
  /** Whether the user is currently authenticated. */
  isAuthenticated: boolean;
  /** Whether page history (version snapshots) is enabled for the current workspace plan. */
  enablePageHistory?: boolean;
  /** Whether server-backed AI features are enabled for this deployment/workspace. */
  aiEnabled?: boolean;
  /** Switch the active workspace. Triggers full data reload. */
  onChangeWorkspace: (workspaceId: string) => Promise<void>;
  /** Error from loading workspace info — allows consumers to show error/retry UI. */
  workspaceInfoError?: Error;
  /** Retry loading workspace info after a failure. */
  retryLoadWorkspaceInfo?: () => void;
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
