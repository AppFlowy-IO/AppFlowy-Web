import { useDatabaseView } from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import React, { useMemo } from 'react';
import GridSettings from './GridSettings';

function Settings ({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = useDatabaseView();

  const layout = Number(view?.get(YjsDatabaseKey.layout));

  const Component = useMemo(() => {

    switch (layout) {
      case DatabaseViewLayout.Grid:
        return GridSettings;
      case DatabaseViewLayout.Board:
        return null;
      default:
        return null;
    }
  }, [layout]);

  if (!Component) {
    return null;
  }

  return (
    <Component>{children}</Component>
  );
}

export default Settings;