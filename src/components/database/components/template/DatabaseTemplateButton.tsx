import { Dialog } from '@mui/material';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  DatabaseContext,
  useCreateRow,
  useDatabase,
  useDatabaseContext,
  useDatabaseView,
  useDocGuid,
  useReadOnly,
} from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { getPrimaryFieldId } from '@/application/database-yjs/selector';
import {
  DatabaseRowTemplate,
  initializeTemplateSourceRow,
  mergeTemplateViewDecorations,
  templateDecorationsNeedResolution,
  templateCoverToViewCover,
  updateTemplateFromSourceRow,
} from '@/application/database-yjs/template';
import { useDatabaseRowTemplates } from '@/application/database-yjs/template/hooks';
import { getCachedProviderDoc } from '@/application/db';
import { rowDocumentIdFromRowId } from '@/application/row-document/lifecycle';
import { getCachedRowSubDoc } from '@/application/services/js-services/cache';
import { ViewIconType, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ReactComponent as CheckCircleFilledIcon } from '@/assets/icons/database-template/check-circle-filled.svg';
import { ReactComponent as CheckCircleOutlinedIcon } from '@/assets/icons/database-template/check-circle-outlined.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/database-template/details-horizontal.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/database-template/document.svg';
import { ReactComponent as DragIcon } from '@/assets/icons/database-template/drag-element.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/database-template/duplicate.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/database-template/edit.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { DatabaseRowProperties, RowSubDocument } from '@/components/database/components/database-row';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';
import DatabaseRowHeader from '@/components/database/components/header/DatabaseRowHeader';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Log } from '@/utils/log';

type EditingTemplate = {
  templateId: string;
  rowDoc: YDoc;
};

const TEMPLATE_EDITOR_PAPER_PROPS = {
  className:
    'block h-[70vh] max-h-[calc(100vh-48px)] w-[70vw] min-w-[320px] !max-w-[calc(100vw-80px)] overflow-hidden overscroll-contain !rounded-[16px] bg-surface-primary p-0',
} as const;

function encodeDocument(doc?: YDoc | null): string | undefined {
  if (!doc) return undefined;

  const update = Y.encodeStateAsUpdate(doc);
  const chunks: string[] = [];

  for (let index = 0; index < update.length; index += 8192) {
    chunks.push(String.fromCharCode(...update.subarray(index, index + 8192)));
  }

  return btoa(chunks.join(''));
}

function DatabaseTemplateEditor({
  editing,
  template,
  databaseName,
  onClose,
  onSave,
}: {
  editing: EditingTemplate;
  template: DatabaseRowTemplate;
  databaseName: string;
  onClose: (template: DatabaseRowTemplate) => void;
  onSave: (template: DatabaseRowTemplate) => DatabaseRowTemplate;
}) {
  const { t } = useTranslation();
  const parentContext = useDatabaseContext();
  const database = useDatabase();
  const saveTimer = useRef<number>();
  const hasPendingSave = useRef(false);
  const pendingDocumentMetaFlushRef = useRef<(() => void) | null>(null);
  const templateRef = useRef(template);
  const onSaveRef = useRef(onSave);

  useLayoutEffect(() => {
    templateRef.current = template;
    onSaveRef.current = onSave;
  }, [onSave, template]);

  const save = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    hasPendingSave.current = false;
    const savedTemplate = onSaveRef.current(updateTemplateFromSourceRow(templateRef.current, editing.rowDoc, database));

    templateRef.current = savedTemplate;
    return savedTemplate;
  }, [database, editing.rowDoc]);

  const flushPendingSave = useCallback(() => {
    return hasPendingSave.current ? save() : templateRef.current;
  }, [save]);

  const flushPendingTemplateChanges = useCallback(() => {
    // The document editor derives IsDocumentEmpty asynchronously from Slate.
    // Flush that child state before taking the final row/template snapshot.
    pendingDocumentMetaFlushRef.current?.();
    return flushPendingSave();
  }, [flushPendingSave]);

  const registerPendingDocumentMetaFlush = useCallback((flush: (() => void) | null) => {
    pendingDocumentMetaFlushRef.current = flush;
  }, []);

  const close = useCallback(() => {
    const savedTemplate = flushPendingTemplateChanges();

    onClose(savedTemplate);
  }, [flushPendingTemplateChanges, onClose]);

  useEffect(() => {
    const root = editing.rowDoc.getMap(YjsEditorKey.data_section);
    const row = root.get(YjsEditorKey.database_row) as Y.Map<unknown> | undefined;
    const meta = root.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;

    if (!row || !meta) return;

    const onChange = () => {
      window.clearTimeout(saveTimer.current);
      hasPendingSave.current = true;
      saveTimer.current = window.setTimeout(save, 250);
    };

    row.observeDeep(onChange);
    meta.observe(onChange);
    return () => {
      pendingDocumentMetaFlushRef.current?.();
      row.unobserveDeep(onChange);
      meta.unobserve(onChange);
      flushPendingSave();
    };
  }, [editing.rowDoc, flushPendingSave, save]);

  const editorContext = useMemo(
    () => ({
      ...parentContext,
      isDatabaseRowPage: false,
      rowMap: { ...(parentContext.rowMap ?? {}), [editing.templateId]: editing.rowDoc },
      ensureRow: (rowId: string) =>
        rowId === editing.templateId ? Promise.resolve(editing.rowDoc) : parentContext.ensureRow?.(rowId),
    }),
    [editing.rowDoc, editing.templateId, parentContext]
  );

  return (
    <Dialog
      open
      maxWidth={false}
      onClose={close}
      aria-labelledby='database-template-editor-title'
      aria-describedby='database-template-editor-description'
      PaperProps={TEMPLATE_EDITOR_PAPER_PROPS}
    >
      <div className='h-full w-full' data-testid='database-template-editor'>
        <div id='database-template-editor-title' className='sr-only'>
          Edit database template
        </div>
        <div id='database-template-editor-description' className='sr-only'>
          Changes to this page and its properties are used when the template creates a new row.
        </div>
        <DatabaseContext.Provider value={editorContext}>
          <div className='appflowy-scroll-container h-full w-full overflow-y-auto pb-10'>
            <div
              className='border-b border-[#F5A623]/40 bg-[#F5A623]/20 px-3 py-4 text-sm font-normal text-text-primary'
              data-testid='database-template-editor-banner'
            >
              {t('grid.rowTemplate.editingTemplateIn', {
                databaseName,
                defaultValue: `You're editing a template in ${databaseName}`,
              })}
            </div>
            <div className='mt-6'>
              <DatabaseRowHeader rowId={editing.templateId} templateStyle />
            </div>
            <div className='mt-4 pl-10 pr-[60px] max-sm:px-6'>
              <DatabaseRowProperties rowId={editing.templateId} templateStyle />
            </div>
            <div className='mx-[60px] mt-5 border-t border-border-primary max-sm:mx-6' />
            <div className='mt-2 h-[clamp(260px,45vh,520px)]'>
              <RowSubDocument
                rowId={editing.templateId}
                contentPadding='template'
                onRegisterPendingMetaFlush={registerPendingDocumentMetaFlush}
              />
            </div>
          </div>
        </DatabaseContext.Provider>
      </div>
    </Dialog>
  );
}

export function DatabaseTemplateButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const database = useDatabase();
  const currentView = useDatabaseView();
  const { activeViewId, createRowDocument, duplicateRowDocument, loadRowDocument, loadViewMeta, updatePage } =
    useDatabaseContext();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const createNewRow = useNewRowDispatch();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<EditingTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DatabaseRowTemplate | null>(null);
  const { templates, defaultTemplateId, store } = useDatabaseRowTemplates(
    menuOpen || editing !== null || pendingDelete !== null
  );
  const [templateListElement, setTemplateListElement] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const databaseId = database.get(YjsDatabaseKey.id);
  const viewName = String(currentView?.get(YjsDatabaseKey.name) || 'this view');
  const templateDragData = useMemo(() => templates.map((template) => ({ id: template.templateId })), [templates]);
  const reorderTemplates = useCallback(
    ({
      oldData,
      startIndex,
      finishIndex,
    }: {
      oldData: { id: string }[];
      newData: { id: string }[];
      startIndex: number;
      finishIndex: number;
    }) => {
      const source = oldData[startIndex];
      const target = oldData[finishIndex];

      if (source && target) store.move(source.id, target.id);
    },
    [store]
  );
  const templateDragContext = useDragContextValue({
    data: templateDragData,
    container: templateListElement,
    reorderAction: reorderTemplates,
  });

  const runBusyAction = useCallback(async (fallbackMessage: string, action: () => Promise<unknown>) => {
    if (busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Log.error('[DatabaseTemplateButton] action failed', { fallbackMessage, error });
      toast.error(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const registerSource = useCallback(
    async (templateId: string) => {
      await createRowDocument?.(rowDocumentIdFromRowId(templateId), {
        database_id: databaseId,
        database_view_id: activeViewId,
        row_id: templateId,
      });
    },
    [activeViewId, createRowDocument, databaseId]
  );

  const ensureTemplateRow = useCallback(
    async (template: DatabaseRowTemplate) => {
      if (!createRow) throw new Error('No createRow function');

      const rowDoc = await createRow(getRowKey(guid, template.templateId));
      const root = rowDoc.getMap(YjsEditorKey.data_section);

      if (!root.has(YjsEditorKey.database_row)) {
        initializeTemplateSourceRow(rowDoc, database, template);
      }

      return rowDoc;
    },
    [createRow, database, guid]
  );

  const loadTemplateDocument = useCallback(
    async (template: DatabaseRowTemplate) => {
      return (
        getCachedRowSubDoc(template.docViewId) ??
        getCachedProviderDoc(template.docViewId) ??
        (await loadRowDocument?.(template.docViewId)) ??
        null
      );
    },
    [loadRowDocument]
  );

  const migrateSnapshotBackedTemplate = useCallback(
    async (template: DatabaseRowTemplate, targetRowDoc: YDoc): Promise<DatabaseRowTemplate> => {
      const targetDocumentId = rowDocumentIdFromRowId(template.templateId);
      const hasPersistedSnapshot = (template.documentData?.length ?? 0) > 0 || template.embeddedDatabases.length > 0;

      if (template.docViewId === targetDocumentId && !hasPersistedSnapshot) {
        // The row-document editor creates the orphan view when it mounts. The
        // server source only has to be registered synchronously immediately
        // before a duplication request.
        return template;
      }

      // Desktop does not maintain Web's hidden source-row collab, so refresh
      // its editable properties before migrating Desktop snapshot metadata.
      initializeTemplateSourceRow(targetRowDoc, database, template);

      if (template.isDocumentEmpty) {
        return store.upsert({
          ...updateTemplateFromSourceRow(template, targetRowDoc, database),
          docViewId: targetDocumentId,
          documentData: undefined,
          embeddedDatabases: [],
        });
      }

      if (!duplicateRowDocument) {
        throw new Error('Template document duplication is unavailable');
      }

      const sourceDocument = await loadTemplateDocument(template);

      if (!sourceDocument) {
        throw new Error('Template document is unavailable for live editing');
      }

      const stagingId = uuidv4();
      const stagingTemplate: DatabaseRowTemplate = {
        ...template,
        templateId: stagingId,
        name: '',
        docViewId: rowDocumentIdFromRowId(stagingId),
      };
      const stagingRowDoc = await ensureTemplateRow(stagingTemplate);

      initializeTemplateSourceRow(stagingRowDoc, database, stagingTemplate);
      // The duplication worker resolves template-owned database snapshots by
      // source template ID. Publish this temporary source just for the copy,
      // then remove it regardless of success.
      store.upsertTransientMigrationSource(stagingTemplate);
      try {
        await duplicateRowDocument(databaseId, stagingId, template.templateId, encodeDocument(sourceDocument), () =>
          registerSource(stagingId)
        );
      } finally {
        store.deleteTransientMigrationSource(stagingId);
      }

      const migrated = store.upsert({
        ...updateTemplateFromSourceRow(template, targetRowDoc, database),
        docViewId: targetDocumentId,
        documentData: undefined,
        embeddedDatabases: [],
      });

      return migrated;
    },
    [database, databaseId, duplicateRowDocument, ensureTemplateRow, loadTemplateDocument, registerSource, store]
  );

  const editTemplate = useCallback(
    async (template: DatabaseRowTemplate) => {
      let editableTemplate = template;

      if (templateDecorationsNeedResolution(template) && template.docViewId && loadViewMeta) {
        try {
          editableTemplate = mergeTemplateViewDecorations(template, await loadViewMeta(template.docViewId));
        } catch (error) {
          Log.warn('[DatabaseTemplateButton] failed to resolve template view decorations', {
            templateId: template.templateId,
            error,
          });
        }
      }

      const rowDoc = await ensureTemplateRow(editableTemplate);

      const migrated = await migrateSnapshotBackedTemplate(editableTemplate, rowDoc);

      if (migrated !== template && (migrated.icon !== template.icon || migrated.cover !== template.cover)) {
        store.upsert(migrated);
      }

      setEditing({ templateId: template.templateId, rowDoc });
    },
    [ensureTemplateRow, loadViewMeta, migrateSnapshotBackedTemplate, store]
  );

  const createTemplate = useCallback(async () => {
    const templateId = uuidv4();
    const now = Date.now();
    const primaryFieldId = getPrimaryFieldId(database);
    const template = store.upsert({
      templateId,
      name: t('grid.rowTemplate.newTemplate', { defaultValue: 'New template' }),
      docViewId: rowDocumentIdFromRowId(templateId),
      isDocumentEmpty: true,
      embeddedDatabases: [],
      icon: '',
      cover: '',
      defaultCells: primaryFieldId
        ? {
            [primaryFieldId]: {
              type: 'text',
              value: t('grid.rowTemplate.newTemplate', { defaultValue: 'New template' }),
            },
          }
        : {},
      createdAtMs: now,
      updatedAtMs: now,
    });

    await editTemplate(template);
  }, [database, editTemplate, store, t]);

  const syncTemplateViewMetadata = useCallback(
    async (template: DatabaseRowTemplate) => {
      try {
        const existingView = await loadViewMeta?.(template.docViewId).catch(() => null);

        await updatePage?.(template.docViewId, {
          name: template.name,
          icon: { ty: ViewIconType.Emoji, value: template.icon ?? '' },
          extra: {
            ...(existingView?.extra ?? {}),
            cover: templateCoverToViewCover(template.cover),
            database_row_template: true,
            database_view_id: activeViewId,
            template_id: template.templateId,
          },
        });
      } catch (error) {
        Log.warn('[DatabaseTemplateButton] failed to sync template view metadata', {
          templateId: template.templateId,
          error,
        });
      }
    },
    [activeViewId, loadViewMeta, updatePage]
  );

  const duplicateTemplate = useCallback(
    async (source: DatabaseRowTemplate) => {
      if (!source.isDocumentEmpty && !duplicateRowDocument) {
        throw new Error('Template document duplication is unavailable');
      }

      const templateId = uuidv4();
      const now = Date.now();
      const duplicate: DatabaseRowTemplate = {
        ...source,
        templateId,
        name: `${source.name} ${t('grid.rowTemplate.copySuffix', { defaultValue: '(Copy)' })}`,
        docViewId: rowDocumentIdFromRowId(templateId),
        documentData: undefined,
        embeddedDatabases: [],
        createdAtMs: now,
        updatedAtMs: now,
      };
      const sourceDocumentPromise = source.isDocumentEmpty ? Promise.resolve(null) : loadTemplateDocument(source);
      const [sourceRowDoc, targetRowDoc, sourceDocument] = await Promise.all([
        ensureTemplateRow(source),
        ensureTemplateRow(duplicate),
        sourceDocumentPromise,
      ]);

      initializeTemplateSourceRow(sourceRowDoc, database, source);
      initializeTemplateSourceRow(targetRowDoc, database, duplicate);

      if (!source.isDocumentEmpty && duplicateRowDocument) {
        await duplicateRowDocument(
          databaseId,
          source.templateId,
          duplicate.templateId,
          encodeDocument(sourceDocument),
          () => registerSource(source.templateId)
        );
      } else {
        await registerSource(duplicate.templateId);
      }

      const persistedDuplicate = store.upsert(duplicate);

      void syncTemplateViewMetadata(persistedDuplicate);
      const sourceIndex = templates.findIndex((template) => template.templateId === source.templateId);
      const followingTemplate = templates[sourceIndex + 1];

      if (followingTemplate) {
        store.move(duplicate.templateId, followingTemplate.templateId);
      }
    },
    [
      database,
      databaseId,
      duplicateRowDocument,
      ensureTemplateRow,
      loadTemplateDocument,
      registerSource,
      store,
      syncTemplateViewMetadata,
      templates,
      t,
    ]
  );

  const saveEditingTemplate = useCallback(
    (template: DatabaseRowTemplate) => {
      return store.upsert(template);
    },
    [store]
  );

  const closeTemplateEditor = useCallback(
    (template: DatabaseRowTemplate) => {
      void syncTemplateViewMetadata(template);
      setEditing(null);
    },
    [syncTemplateViewMetadata]
  );

  const activeTemplate = editing ? templates.find((template) => template.templateId === editing.templateId) : undefined;

  if (readOnly) return null;

  return (
    <>
      <div
        aria-busy={busy}
        className={`flex items-stretch ${compact ? 'h-6' : 'h-7'}`}
        data-testid='database-template-split-button'
      >
        <Button
          className={`${compact ? 'h-6' : 'h-7'} rounded-r-none px-1.5 text-xs font-normal leading-3`}
          disabled={busy}
          loading={busy}
          onClick={() =>
            void runBusyAction('Failed to create database row', () =>
              createNewRow({ tailing: true, openAfterCreate: true })
            )
          }
          data-testid='database-new-row-button'
        >
          {busy ? <LoaderCircle aria-hidden='true' className='h-4 w-4 animate-spin' /> : null}
          {t('grid.createView', { defaultValue: 'New' })}
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label='Open database templates'
              className={`relative ${
                compact ? 'h-6 w-6' : 'h-7 w-7'
              } rounded-l-none p-0 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-white/30`}
              disabled={busy}
              data-testid='database-template-menu-trigger'
            >
              <ChevronDown aria-hidden='true' className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            className='flex max-h-[400px] w-[300px] min-w-[220px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[10px] p-[6px] shadow-[var(--shadows-sm)]'
            data-testid='database-template-menu'
          >
            <DropdownMenuLabel className='min-h-0 shrink-0 px-[6px] pb-3 pt-[6px] leading-[14px]'>
              {t('grid.rowTemplate.templatesFor', {
                databaseName: viewName,
                defaultValue: `Templates for ${viewName}`,
              })}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className='mx-0 my-0 shrink-0' />
            {templates.length === 0 ? (
              <div className='shrink-0 p-4 text-center text-[13px] leading-4 text-text-tertiary'>
                {t('grid.rowTemplate.noTemplatesYet', { defaultValue: 'No templates yet' })}
              </div>
            ) : (
              <DragContext.Provider value={templateDragContext}>
                <div
                  ref={setTemplateListElement}
                  className='min-h-0 overflow-y-auto overscroll-contain'
                  data-testid='database-template-list'
                >
                  {templates.map((template, index) => (
                    <DragItem
                      key={template.templateId}
                      id={template.templateId}
                      className='group min-h-7 items-stretch rounded-[6px] px-[6px] focus-within:bg-fill-content-hover hover:bg-fill-content-hover'
                      dragHandleLabel={`Reorder ${template.name}`}
                      onMoveUp={
                        index > 0 ? () => store.move(template.templateId, templates[index - 1].templateId) : undefined
                      }
                      onMoveDown={
                        index < templates.length - 1
                          ? () => store.move(template.templateId, templates[index + 1].templateId)
                          : undefined
                      }
                      dragIcon={
                        <DragIcon className='h-4 w-4 text-icon-secondary' data-testid='database-template-drag-handle' />
                      }
                    >
                      <div
                        className='flex min-w-0 flex-1 items-stretch'
                        data-testid={`database-template-row-${template.templateId}`}
                      >
                        <DropdownMenuItem
                          className='min-h-7 min-w-0 flex-1 gap-2 rounded-r-none bg-transparent px-0 py-[2px] text-sm hover:bg-transparent focus:bg-transparent [&_svg]:h-4 [&_svg]:w-4'
                          onSelect={() =>
                            void runBusyAction('Failed to create row from template', () =>
                              createNewRow({ templateId: template.templateId, tailing: true, openAfterCreate: true })
                            )
                          }
                          data-testid={`database-template-${template.templateId}`}
                        >
                          <DocumentIcon className='text-icon-secondary' data-testid='database-template-document-icon' />
                          <span className='min-w-0 flex-1 truncate leading-[17px]'>{template.name}</span>
                          {defaultTemplateId === template.templateId ? (
                            <span className='flex-none rounded bg-fill-theme-select px-1.5 py-0.5 text-[11px] font-medium leading-[13px] text-text-action'>
                              {t('colors.default', { defaultValue: 'Default' })}
                            </span>
                          ) : null}
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger
                            aria-label={`Actions for ${template.name}`}
                            className='ml-1.5 min-h-7 w-6 flex-none gap-0 rounded-l-none bg-transparent p-0 hover:bg-transparent focus:bg-transparent [&>svg]:hidden [&_svg]:h-4 [&_svg]:w-4'
                            data-testid={`database-template-actions-${template.templateId}`}
                          >
                            <span className='flex h-4 w-4 items-center justify-center text-icon-secondary'>
                              <MoreIcon />
                            </span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className='min-w-[160px] max-w-[200px] rounded-[10px] border border-border-primary p-[6px] shadow-[var(--shadows-sm)] [&_svg]:h-4 [&_svg]:w-4'>
                            <DropdownMenuItem
                              onSelect={() =>
                                void runBusyAction('Failed to open database template', () => editTemplate(template))
                              }
                              data-testid={`database-template-edit-${template.templateId}`}
                            >
                              <EditIcon data-testid='database-template-edit-icon' />{' '}
                              {t('button.edit', { defaultValue: 'Edit' })}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className='mx-0 my-0' />
                            <DropdownMenuItem
                              onSelect={() =>
                                void runBusyAction('Failed to duplicate database template', () =>
                                  duplicateTemplate(template)
                                )
                              }
                              data-testid={`database-template-duplicate-${template.templateId}`}
                            >
                              <DuplicateIcon data-testid='database-template-duplicate-icon' />{' '}
                              {t('button.duplicate', { defaultValue: 'Duplicate' })}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className='mx-0 my-0' />
                            <DropdownMenuItem
                              onSelect={() =>
                                store.setDefault(
                                  defaultTemplateId === template.templateId ? undefined : template.templateId
                                )
                              }
                              data-testid={`database-template-default-${template.templateId}`}
                            >
                              {defaultTemplateId === template.templateId ? (
                                <CheckCircleFilledIcon
                                  data-icon-style='filled'
                                  data-testid='database-template-default-icon'
                                />
                              ) : (
                                <CheckCircleOutlinedIcon
                                  data-icon-style='outlined'
                                  data-testid='database-template-default-icon'
                                />
                              )}{' '}
                              {defaultTemplateId === template.templateId
                                ? t('grid.rowTemplate.clearDefault', { defaultValue: 'Clear default' })
                                : t('grid.rowTemplate.setAsDefault', { defaultValue: 'Set as default' })}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className='mx-0 my-0' />
                            <DropdownMenuItem
                              variant='destructive'
                              onSelect={() => setPendingDelete(template)}
                              data-testid={`database-template-delete-${template.templateId}`}
                            >
                              <DeleteIcon data-testid='database-template-delete-icon' />{' '}
                              {t('button.delete', { defaultValue: 'Delete' })}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </div>
                    </DragItem>
                  ))}
                </div>
              </DragContext.Provider>
            )}
            <DropdownMenuSeparator className='mx-0 my-0 shrink-0' />
            <DropdownMenuItem
              className='min-h-0 shrink-0 gap-1.5 px-3 py-2 text-sm leading-4 text-text-action [&_svg]:h-4 [&_svg]:w-4'
              onSelect={() => void runBusyAction('Failed to create database template', () => createTemplate())}
              data-testid='database-template-create'
            >
              <PlusIcon data-testid='database-template-create-icon' />{' '}
              {t('grid.rowTemplate.newTemplate', { defaultValue: 'New template' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing && activeTemplate ? (
        <DatabaseTemplateEditor
          editing={editing}
          template={activeTemplate}
          databaseName={viewName}
          onClose={closeTemplateEditor}
          onSave={saveEditingTemplate}
        />
      ) : null}
      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('button.delete', { defaultValue: 'Delete' })}
        description={
          pendingDelete
            ? t('grid.rowTemplate.deleteTemplateConfirmation', {
                templateName: pendingDelete.name,
                defaultValue: `Are you sure you want to delete "${pendingDelete.name}"?`,
              })
            : ''
        }
        cancelText={t('button.cancel', { defaultValue: 'Cancel' })}
        confirmText={t('button.delete', { defaultValue: 'Delete' })}
        onConfirm={() => {
          if (pendingDelete) store.delete(pendingDelete.templateId);
          setPendingDelete(null);
        }}
        dialogTestId='database-template-delete-dialog'
        confirmTestId='database-template-delete-confirm'
      />
    </>
  );
}

export default DatabaseTemplateButton;
