import { DatabaseViewLayout } from '@/application/types';
import BoardSettings from '@/components/database/components/settings/BoardSettings';
import CalendarSettings from '@/components/database/components/settings/CalendarSettings';
import ChartSettings from '@/components/database/components/settings/ChartSettings';
import GallerySettings from '@/components/database/components/settings/GallerySettings';
import ListSettings from '@/components/database/components/settings/ListSettings';

import GridSettings from './GridSettings';

import type { ComponentType, ReactNode } from 'react';

const SETTINGS_BY_LAYOUT: Partial<Record<DatabaseViewLayout, ComponentType<{ children: ReactNode }>>> = {
  [DatabaseViewLayout.Grid]: GridSettings,
  [DatabaseViewLayout.Board]: BoardSettings,
  [DatabaseViewLayout.Calendar]: CalendarSettings,
  [DatabaseViewLayout.Chart]: ChartSettings,
  [DatabaseViewLayout.List]: ListSettings,
  [DatabaseViewLayout.Gallery]: GallerySettings,
};

function Settings({ children, layout }: { children: ReactNode; layout: DatabaseViewLayout }) {
  const Component = SETTINGS_BY_LAYOUT[layout];

  if (!Component) return null;

  return <Component>{children}</Component>;
}

export default Settings;
