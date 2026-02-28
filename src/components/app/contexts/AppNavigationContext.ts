import { createContext } from 'react';

import { AppendBreadcrumb, View } from '@/application/types';

// Navigation state — changes frequently on page navigation
export interface AppNavigationContextType {
  viewId?: string;
  breadcrumbs?: View[];
  appendBreadcrumb?: AppendBreadcrumb;
  rendered?: boolean;
  onRendered?: () => void;
  notFound?: boolean;
  viewHasBeenDeleted?: boolean;
  openPageModalViewId?: string;
  openPageModal?: (viewId: string) => void;
}

export const AppNavigationContext = createContext<AppNavigationContextType | null>(null);
