import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { useDatabase, useDatabaseViewId, useReadOnly, useSharedRoot } from '@/application/database-yjs/context';
import { FieldType, FieldVisibility, TimelineDependencyDirection } from '@/application/database-yjs/database.type';
import { addFieldToAllViews } from '@/application/database-yjs/dispatch/relation';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import { readTimelineLayoutSetting, updateTimelineLayoutSetting } from '@/application/database-yjs/timeline-layout';
import { YDatabaseField, YDatabaseFieldSetting, YjsDatabaseKey } from '@/application/types';

/**
 * Notion's one-click dependencies: bind a two-way self-relation pair
 * ("Blocked by" / "Blocking") to the timeline, creating the pair when the
 * database has none. Both properties become table columns; neither is drawn
 * as a bar chip. Resolves with the bound "Blocked by" field id.
 */
export function useSetUpTimelineDependenciesDispatch() {
  const { t } = useTranslation();
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const sharedRoot = useSharedRoot();

  return useCallback((): string | undefined => {
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const fields = database?.get(YjsDatabaseKey.fields);
    const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;

    if (readOnly || !view || !fields || !databaseId) return undefined;
    const current = readTimelineLayoutSetting(database, viewId, 0, false);

    if (current.dependencyFieldId && fields.has(current.dependencyFieldId)) return current.dependencyFieldId;

    // Reuse an existing two-way self-relation pair rather than adding a second one.
    let blockedById = '';
    let blockingId = '';

    fields.forEach((field: YDatabaseField, fieldId: string) => {
      if (blockedById || Number(field.get(YjsDatabaseKey.type)) !== FieldType.Relation) return;
      const option = parseRelationTypeOption(field);

      if (
        option.database_id === databaseId &&
        option.is_two_way &&
        option.reciprocal_field_id &&
        fields.has(option.reciprocal_field_id)
      ) {
        blockedById = fieldId;
        blockingId = option.reciprocal_field_id;
      }
    });

    const creating = !blockedById;

    if (creating) {
      blockedById = nanoid(6);
      blockingId = nanoid(6);
    }

    executeOperations(
      sharedRoot,
      [
        () => {
          if (creating) {
            fields.set(
              blockedById,
              createRelationField(blockedById, {
                name: t('timeline.blockedBy', { defaultValue: 'Blocked by' }),
                database_id: databaseId,
                is_two_way: true,
                reciprocal_field_id: blockingId,
              })
            );
            fields.set(
              blockingId,
              createRelationField(blockingId, {
                name: t('timeline.blocking', { defaultValue: 'Blocking' }),
                database_id: databaseId,
                is_two_way: true,
                reciprocal_field_id: blockedById,
              })
            );
            addFieldToAllViews(database, blockedById);
            addFieldToAllViews(database, blockingId);
          }

          // Keep the pair off this view's bars; the arrows already show it.
          const fieldSettings = view.get(YjsDatabaseKey.field_settings);

          [blockedById, blockingId].forEach((fieldId) => {
            if (!fieldSettings) return;
            let setting = fieldSettings.get(fieldId);

            if (!setting) {
              setting = new Y.Map() as YDatabaseFieldSetting;
              fieldSettings.set(fieldId, setting);
            }

            setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
          });

          const tableFieldIds = current.tableFieldIds.filter((id) => id !== blockedById && id !== blockingId);

          updateTimelineLayoutSetting(view, {
            dependencyFieldId: blockedById,
            dependencyDirection: TimelineDependencyDirection.BlockedBy,
            tableFieldIds: [...tableFieldIds, blockedById, blockingId],
          });
        },
      ],
      'setUpTimelineDependencies'
    );

    return blockedById;
  }, [database, readOnly, sharedRoot, t, viewId]);
}
