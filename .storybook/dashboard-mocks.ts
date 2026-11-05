import type { DashboardContextValue } from '@/components/database/dashboard/DashboardContext';
import { createInertOwnedWidgetViews } from '@/components/database/dashboard/hooks/useOwnedWidgetViews';

/** Empty dashboard previews never load or write workspace data. */
export const mockDashboardContextValue: DashboardContextValue = {
  dashboardViewId: 'storybook-dashboard',
  hostDatabaseId: 'storybook-database',
  canEdit: true,
  isEditing: false,
  setEditing: () => undefined,
  mobileContext: false,
  canEnterEdit: true,
  pinEditing: () => undefined,
  updateSetting: () => undefined,
  updateRows: () => false,
  ownedViews: createInertOwnedWidgetViews(),
};
