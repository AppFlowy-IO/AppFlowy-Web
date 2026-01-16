import React, { useMemo } from 'react';

import { useDatabaseView } from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import BoardSettings from '@/components/database/components/settings/BoardSettings';
import CalendarSettings from '@/components/database/components/settings/CalendarSettings';
import ChartSettings from '@/components/database/components/settings/ChartSettings';

import GridSettings from './GridSettings';

function Settings({ children }: { children: React.ReactNode }) {
  const view = useDatabaseView();

  const layout = Number(view?.get(YjsDatabaseKey.layout));

  const Component = useMemo(() => {
    switch (layout) {
      case DatabaseViewLayout.Grid:
        return GridSettings;
      case DatabaseViewLayout.Board:
        return BoardSettings;
      case DatabaseViewLayout.Calendar:
        return CalendarSettings;
      case DatabaseViewLayout.Chart:
        return ChartSettings;
      default:
        return null;
    }
  }, [layout]);

  if (!Component) {
    return null;
  }

  return <Component>{children}</Component>;
}

export default Settings;
