import { lazy, Suspense } from 'react';

import { DatabaseViewLayout } from '@/application/types';
import BoardSettings from '@/components/database/components/settings/BoardSettings';
import CalendarSettings from '@/components/database/components/settings/CalendarSettings';
import ChartSettings from '@/components/database/components/settings/ChartSettings';
import ListSettings from '@/components/database/components/settings/ListSettings';

import GridSettings from './GridSettings';

import type { ComponentType, ReactNode } from 'react';

const GallerySettings = lazy(() => import('@/components/database/components/settings/GallerySettings'));

const SETTINGS_BY_LAYOUT: Partial<Record<DatabaseViewLayout, ComponentType<{ children: ReactNode }>>> = {
  [DatabaseViewLayout.Grid]: GridSettings,
  [DatabaseViewLayout.Board]: BoardSettings,
  [DatabaseViewLayout.Calendar]: CalendarSettings,
  [DatabaseViewLayout.Chart]: ChartSettings,
  [DatabaseViewLayout.List]: ListSettings,
};

function Settings({ children, layout }: { children: ReactNode; layout: DatabaseViewLayout }) {
  if (layout === DatabaseViewLayout.Gallery) {
    return (
      <Suspense fallback={children}>
        <GallerySettings>{children}</GallerySettings>
      </Suspense>
    );
  }

  const Component = SETTINGS_BY_LAYOUT[layout];

  if (!Component) return null;

  return <Component>{children}</Component>;
}

export default Settings;
