import { useCallback, useRef } from 'react';

import { FieldType } from '@/application/database-yjs';
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  DatabasePrompt,
  DatabasePromptField,
  DatabasePromptRow,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { PromptDatabaseConfiguration } from '@/components/chat';

import { useAuthInternal } from '../contexts/AuthInternalContext';

// Hook for managing database-related operations
export function useDatabaseOperations(
  loadView?: (id: string, isSubDocument?: boolean, loadAwareness?: boolean) => Promise<YDoc | null>,
  createRow?: (rowKey: string) => Promise<YDoc>
) {
  const { service, currentWorkspaceId } = useAuthInternal();

  const rowDocsRef = useRef<Map<string, DatabasePromptRow>>(new Map());

  // Generate AI summary for row
  const generateAISummaryForRow = useCallback(
    async (payload: GenerateAISummaryRowPayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.generateAISummaryForRow(currentWorkspaceId, payload);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Generate AI translation for row
  const generateAITranslateForRow = useCallback(
    async (payload: GenerateAITranslateRowPayload) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      try {
        const res = await service?.generateAITranslateForRow(currentWorkspaceId, payload);

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  // Get rows from database view
  const getRows = useCallback(
    async (viewId: string) => {
      if (!currentWorkspaceId) return [];

      const doc = await loadView?.(viewId);
      const database = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase;
      const view = database.get(YjsDatabaseKey.views).get(viewId);
      const rowOrders = view?.get(YjsDatabaseKey.row_orders) || [];

      const rowPromises = rowOrders
        .map(async (row: { id: string }) => {
          if (rowDocsRef.current.has(row.id)) {
            return rowDocsRef.current.get(row.id);
          }

          if (!createRow) return;

          const rowKey = getRowKey(doc?.guid || '', row.id);
          const rowDoc = await createRow(rowKey);

          const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = rowSharedRoot?.get(YjsEditorKey.database_row) as { [fieldId: string]: any };

          const databaseRow = {
            id: row.id,
            data,
          };

          rowDocsRef.current.set(row.id, databaseRow);

          return databaseRow;
        })
        .filter((p): p is Promise<DatabasePromptRow> => p !== undefined);

      return Promise.all(rowPromises);
    },
    [createRow, currentWorkspaceId, loadView]
  );

  // Get fields from database view
  const getFields = useCallback(
    async (viewId: string) => {
      if (!currentWorkspaceId) return [];

      const doc = await loadView?.(viewId);
      const database = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase;
      const fields = database.get(YjsDatabaseKey.fields);

      return Array.from(fields.entries())
        .map(([id, field]) => {
          const isPrimary = field.get(YjsDatabaseKey.is_primary) || false;
          const name = field.get(YjsDatabaseKey.name) || '';
          const fieldType = Number(field.get(YjsDatabaseKey.type));
          const isSelect = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;

          return {
            id,
            name,
            fieldType,
            isPrimary,
            isSelect,
            data: field,
          };
        })
        .filter((f) => [FieldType.RichText, FieldType.SingleSelect, FieldType.MultiSelect].includes(f.fieldType));
    },
    [currentWorkspaceId, loadView]
  );

  // Load database prompts with fields
  const loadDatabasePromptsWithFields = useCallback(
    async (
      config: PromptDatabaseConfiguration,
      fields: {
        id: string;
        name: string;
        isPrimary: boolean;
        fieldType: FieldType;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any;
      }[]
    ) => {
      const titleField = fields.find((field) => field.id === config.titleFieldId);

      if (!titleField) {
        throw new Error('Cannot find title field');
      }

      const contentField = fields.find((field) => field.id === config.contentFieldId);

      if (!contentField) {
        throw new Error('Cannot find content field');
      }

      const exampleField = config.exampleFieldId
        ? fields.find((field) => field.id === config.exampleFieldId)
        : undefined;

      const categoryField = config.categoryFieldId
        ? fields.find((field) => field.id === config.categoryFieldId)
        : undefined;

      const rows = await getRows(config.databaseViewId);

      return rows
        .map((row) => {
          const cells = row?.data.get(YjsDatabaseKey.cells);

          const nameCell = cells?.get(titleField.id);
          const name = nameCell && titleField ? getCellDataText(nameCell, titleField.data) : '';

          const contentCell = cells?.get(contentField.id);
          const content = contentCell && contentField ? getCellDataText(contentCell, contentField.data) : '';

          if (!name || !content) return null;

          const exampleCell = exampleField ? cells?.get(exampleField.id) : null;
          const example = exampleCell && exampleField ? getCellDataText(exampleCell, exampleField.data) : '';

          const categoryCell = categoryField ? cells?.get(categoryField.id) : null;
          const category = categoryCell && categoryField ? getCellDataText(categoryCell, categoryField.data) : '';

          return {
            id: row.id,
            name,
            content,
            example,
            category,
          };
        })
        .filter((prompt): prompt is DatabasePrompt => prompt !== null);
    },
    [getRows]
  );

  // Load database prompts
  const loadDatabasePrompts = useCallback(
    async (
      config: PromptDatabaseConfiguration
    ): Promise<{
      rawDatabasePrompts: DatabasePrompt[];
      fields: DatabasePromptField[];
    }> => {
      const fields = await getFields(config.databaseViewId);

      const rawDatabasePrompts = await loadDatabasePromptsWithFields(config, fields);

      return {
        rawDatabasePrompts,
        fields: fields.map((field) => ({
          id: field.id,
          name: field.name,
          isPrimary: field.isPrimary,
          isSelect: field.fieldType === FieldType.SingleSelect || field.fieldType === FieldType.MultiSelect,
        })),
      };
    },
    [getFields, loadDatabasePromptsWithFields]
  );

  // Test database prompt configuration
  const testDatabasePromptConfig = useCallback(
    async (viewId: string) => {
      const fields = await getFields(viewId);
      const titleField = fields.find((field) => field.isPrimary);

      if (!titleField) {
        throw new Error('Cannot find primary field');
      }

      const contentField = fields.find(
        (field) =>
          !field.isPrimary &&
          ((field.name.toLowerCase() === 'content' && field.fieldType === FieldType.RichText) ||
            field.fieldType === FieldType.RichText)
      );

      if (!contentField) {
        throw new Error('Cannot find content field');
      }

      const exampleField = fields.find(
        (field) => field.name.toLowerCase() === 'example' && field.fieldType === FieldType.RichText
      );
      const categoryField = fields.find(
        (field) => field.name.toLowerCase() === 'category' && field.fieldType === FieldType.RichText
      );

      const config: PromptDatabaseConfiguration = {
        databaseViewId: viewId,
        titleFieldId: titleField.id,
        contentFieldId: contentField.id,
        exampleFieldId: exampleField?.id || null,
        categoryFieldId: categoryField?.id || null,
      };

      return { config, fields };
    },
    [getFields]
  );

  // Check if row document exists
  const checkIfRowDocumentExists = useCallback(
    async (documentId: string) => {
      if (!service || !currentWorkspaceId) {
        throw new Error('No service found');
      }

      return service?.checkIfCollabExists(currentWorkspaceId, documentId) || Promise.resolve(false);
    },
    [service, currentWorkspaceId]
  );

  return {
    generateAISummaryForRow,
    generateAITranslateForRow,
    loadDatabasePrompts,
    testDatabasePromptConfig,
    checkIfRowDocumentExists,
  };
}