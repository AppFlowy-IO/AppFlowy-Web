import { useDatabase, useDatabaseViewId } from '@/application/database-yjs/context';
import { YjsDatabaseKey } from '@/application/types';

export function useResizeColumnWidthDispatch () {
  const database = useDatabase();
  const viewId = useDatabaseViewId();

  return (fieldId: string, width: number) => {
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const fields = database?.get(YjsDatabaseKey.fields);
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
    const field = fields?.get(fieldId);
    const fieldSetting = fieldSettings?.get(fieldId);

    if (!field || !fieldSetting) return;

    const currentWidth = fieldSetting.get(YjsDatabaseKey.width);

    if (Number(currentWidth) === width) return;

    fieldSetting.set(YjsDatabaseKey.width, String(width));
  };
}