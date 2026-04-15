import { Button, Divider } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { ViewService } from '@/application/services/domains';
import { getAxios, executeAPIRequest, APIResponse } from '@/application/services/js-services/http/core';
import { getView } from '@/application/services/js-services/http/view-api';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { dataStringTOJson, getBlock } from '@/application/slate-yjs/utils/yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, View, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as CopyLinkIcon } from '@/assets/icons/link.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { createDatabaseNodeData } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import CalloutTextColor from '@/components/editor/components/toolbar/block-controls/CalloutTextColor';
import {
  OutlineCollapseControl,
  OutlineDepthControl,
} from '@/components/editor/components/toolbar/block-controls/OutlineControls';
import { BlockNode, CalloutNode, DatabaseNode, OutlineNode } from '@/components/editor/editor.type';
import { useEditorContext, useEditorLocalState } from '@/components/editor/EditorContext';
import { copyTextToClipboard } from '@/utils/copy';

import CalloutIconControl from './CalloutIconControl';
import CalloutQuickStyleControl from './CalloutQuickStyleControl';
import Color from './Color';
import {
  findDuplicatedContainerChild,
  getDatabaseLayoutFromBlockType,
  isDatabaseBlockType,
} from './databaseDuplicateUtils';

function getViewNoCache(workspaceId: string, viewId: string, depth: number = 1): Promise<View> {
  const url = `/api/workspace/${workspaceId}/view/${viewId}?depth=${depth}&_t=${Date.now()}`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  );
}

const popoverProps: Partial<PopoverProps> = {
  transformOrigin: {
    vertical: 'center',
    horizontal: 'right',
  },
  anchorOrigin: {
    vertical: 'center',
    horizontal: 'left',
  },
  keepMounted: false,
  disableRestoreFocus: true,
  disableEnforceFocus: true,
};

function ControlsMenu({
  open,
  onClose,
  anchorEl,
}: {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}) {
  const { selectedBlockIds } = useEditorLocalState();
  const { workspaceId, loadViewMeta, createDatabaseView, duplicatePage } = useEditorContext();
  const editor = useSlateStatic() as YjsEditor;
  const onlySingleBlockSelected = selectedBlockIds?.length === 1;
  const node = useMemo(() => {
    const blockId = selectedBlockIds?.[0];

    if (!blockId) return null;

    return findSlateEntryByBlockId(editor, blockId);
  }, [selectedBlockIds, editor]);

  const { t } = useTranslation();
  const duplicateCopySuffix = useMemo(() => ` (${t('menuAppHeader.pageNameSuffix')})`, [t]);

  const duplicateDatabaseBlock = useCallback(
    async (sourceNode: DatabaseNode, duplicatedBlockId: string) => {
      const replaceDuplicatedBlockData = (nextData: ReturnType<typeof createDatabaseNodeData>) => {
        const duplicatedBlock = getBlock(duplicatedBlockId, editor.sharedRoot);

        if (!duplicatedBlock) {
          throw new Error(t('document.plugins.subPage.errors.failedDuplicatePage'));
        }

        const previousData = dataStringTOJson(
          duplicatedBlock.get(YjsEditorKey.block_data)
        );

        duplicatedBlock.set(
          YjsEditorKey.block_data,
          JSON.stringify({
            ...previousData,
            ...nextData,
          })
        );
      };

      const parentId = sourceNode.data.parent_id;
      const sourceViewIds = sourceNode.data.view_ids?.length
        ? sourceNode.data.view_ids
        : sourceNode.data.view_id
          ? [sourceNode.data.view_id]
          : [];
      const databaseId = sourceNode.data.database_id;

      if (!parentId || sourceViewIds.length === 0 || !databaseId) {
        throw new Error(t('document.plugins.subPage.errors.failedDuplicateFindView'));
      }

      if (!loadViewMeta || !createDatabaseView) {
        throw new Error(t('document.plugins.subPage.errors.failedDuplicatePage'));
      }

      const firstSourceView = await loadViewMeta(sourceViewIds[0]);

      if (!firstSourceView) {
        throw new Error(t('document.plugins.subPage.errors.failedDuplicateFindView'));
      }

      const isLinkedDuplicate = firstSourceView.parent_view_id === parentId;

      if (isLinkedDuplicate) {
        const sourceViews = await Promise.all(
          sourceViewIds.map((id) => loadViewMeta(id).catch(() => null))
        );

        const duplicatedViewIds = await Promise.all(
          sourceViewIds.map(async (_, i) => {
            const sourceView = sourceViews[i];
            const layout = sourceView?.layout ?? getDatabaseLayoutFromBlockType(sourceNode.type);

            if (layout === undefined) {
              throw new Error(t('document.plugins.subPage.errors.failedDuplicateFindView'));
            }

            const response = await createDatabaseView(parentId, {
              parent_view_id: parentId,
              database_id: databaseId,
              layout,
              name: sourceView?.name,
              embedded: true,
            });

            return response.view_id;
          })
        );

        replaceDuplicatedBlockData(
          createDatabaseNodeData({
            parentId,
            viewIds: duplicatedViewIds,
            databaseId,
          })
        );

        return;
      }

      if (!workspaceId || !duplicatePage) {
        // duplicatePage is not available in all editor contexts (e.g. row sub-documents).
        // Fall back to the shallow block copy without database-specific rewiring.
        return;
      }

      const sourceContainerId = firstSourceView.parent_view_id;

      if (!sourceContainerId) {
        throw new Error(t('document.plugins.subPage.errors.failedDuplicateFindView'));
      }

      ViewService.invalidateCache(workspaceId, sourceContainerId);
      ViewService.invalidateCache(workspaceId, parentId);

      const [sourceContainerView, beforeParentView] = await Promise.all([
        getView(workspaceId, sourceContainerId, 2),
        getView(workspaceId, parentId, 2),
      ]);

      await duplicatePage(sourceContainerId, {
        parentViewId: parentId,
        includeChildren: true,
        suffix: duplicateCopySuffix,
        source: 0,
      });

      let duplicatedContainerView;
      let duplicatedContainer;
      let newPrimaryViewId: string | undefined;
      let newDatabaseId: string | undefined;

      // The folder duplicate call is async with respect to sidebar/view metadata updates.
      // Poll the refreshed parent view instead of assuming the new child is visible immediately.
      // Use cache-busting (_t param) and depth=2 to ensure fresh, complete children lists.
      for (let attempt = 0; attempt < 20; attempt++) {
        ViewService.invalidateCache(workspaceId, parentId);
        const afterParentView = await getViewNoCache(workspaceId, parentId, 2);

        const candidate = findDuplicatedContainerChild({
          beforeChildren: beforeParentView.children,
          afterChildren: afterParentView.children,
          sourceContainerId,
          duplicatedName: `${sourceContainerView.name}${duplicateCopySuffix}`,
        });

        if (!candidate) {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          continue;
        }

        ViewService.invalidateCache(workspaceId, candidate.view_id);
        const candidateContainer = await getViewNoCache(workspaceId, candidate.view_id, 2);
        const candidatePrimaryViewId = candidateContainer.children?.[0]?.view_id;
        const candidateDatabaseId = getDatabaseIdFromExtra(candidateContainer);

        // Inline duplication must produce a brand-new container with a new child view
        // and a new database_id. Keep polling until the fresh duplicate is visible.
        if (
          candidatePrimaryViewId &&
          candidateDatabaseId &&
          (candidatePrimaryViewId !== sourceViewIds[0] || candidateDatabaseId !== databaseId)
        ) {
          duplicatedContainerView = candidate;
          duplicatedContainer = candidateContainer;
          newPrimaryViewId = candidatePrimaryViewId;
          newDatabaseId = candidateDatabaseId;
          break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }

      if (!duplicatedContainerView || !duplicatedContainer || !newPrimaryViewId || !newDatabaseId) {
        throw new Error(t('document.plugins.subPage.errors.failedDuplicatePage'));
      }

      // Map source view IDs to their index positions within the source container,
      // then select the same positions from the duplicated container. This preserves
      // the block's tab subset (e.g., if the block only shows tabs B and C out of
      // A, B, C, the duplicate will also show only B' and C').
      const duplicatedChildIds = duplicatedContainer.children?.map((c) => c.view_id) ?? [];
      const sourceContainerChildIds = sourceContainerView.children?.map((c) => c.view_id) ?? [];
      const mappedViewIds = sourceViewIds
        .map((id) => sourceContainerChildIds.indexOf(id))
        .filter((i) => i >= 0 && i < duplicatedChildIds.length)
        .map((i) => duplicatedChildIds[i]);

      const allDuplicatedViewIds = mappedViewIds.length > 0
        ? mappedViewIds
        : duplicatedChildIds.length > 0
          ? duplicatedChildIds.slice(0, sourceViewIds.length)
          : [newPrimaryViewId];

      replaceDuplicatedBlockData(
        createDatabaseNodeData({
          parentId,
          viewIds: allDuplicatedViewIds,
          databaseId: newDatabaseId,
        })
      );
    },
    [
      createDatabaseView,
      duplicateCopySuffix,
      duplicatePage,
      editor,
      loadViewMeta,
      t,
      workspaceId,
    ]
  );

  const duplicateSelectedBlocks = useCallback(async () => {
    const newBlockIds: string[] = [];
    const prevId = selectedBlockIds?.[selectedBlockIds.length - 1];
    let hasDatabaseBlock = false;

    for (const [index, blockId] of (selectedBlockIds ?? []).entries()) {
      const entry = findSlateEntryByBlockId(editor, blockId);

      if (!entry) {
        continue;
      }

      const [selectedNode] = entry;
      const newBlockId = CustomEditor.duplicateBlock(
        editor,
        blockId,
        index === 0 ? prevId : newBlockIds[index - 1]
      );

      if (!newBlockId) {
        continue;
      }

      newBlockIds.push(newBlockId);

      if (!isDatabaseBlockType(selectedNode.type as BlockType)) {
        continue;
      }

      hasDatabaseBlock = true;

      try {
        await duplicateDatabaseBlock(selectedNode as DatabaseNode, newBlockId);
      } catch (error) {
        // Roll back ALL previously duplicated blocks, not just the current one
        for (const id of newBlockIds) {
          CustomEditor.deleteBlock(editor, id);
        }

        throw error;
      }
    }

    if (hasDatabaseBlock) {
      notify.success(t('button.duplicateSuccessfully'));
    }

    ReactEditor.focus(editor);
    const entry = findSlateEntryByBlockId(editor, newBlockIds[0]);

    if (!entry) {
      return;
    }

    const [, path] = entry;

    editor.select(editor.start(path));
  }, [duplicateDatabaseBlock, editor, selectedBlockIds, t]);

  const options = useMemo(() => {
    return [
      {
        key: 'delete',
        content: t('button.delete'),
        icon: <DeleteIcon />,
        onClick: () => {
          selectedBlockIds?.forEach((blockId) => {
            CustomEditor.deleteBlock(editor, blockId);
          });
        },
      },
      {
        key: 'duplicate',
        content: t('button.duplicate'),
        icon: <DuplicateIcon />,
        onClick: duplicateSelectedBlocks,
      },
      onlySingleBlockSelected && {
        key: 'copyLinkToBlock',
        content: t('document.plugins.optionAction.copyLinkToBlock'),
        icon: <CopyLinkIcon />,
        onClick: async () => {
          const blockId = selectedBlockIds?.[0];

          const url = new URL(window.location.href);

          url.searchParams.set('blockId', blockId);

          await copyTextToClipboard(url.toString());
          notify.success(t('shareAction.copyLinkToBlockSuccess'));
        },
      },
    ].filter(Boolean) as {
      key: string;
      content: string;
      icon: JSX.Element;
      onClick: () => void | Promise<void>;
    }[];
  }, [t, duplicateSelectedBlocks, selectedBlockIds, onlySingleBlockSelected, editor]);

  return (
    <Popover
      anchorEl={anchorEl}
      onClose={() => {
        const path = node?.[1];

        if (path) {
          window.getSelection()?.removeAllRanges();
          ReactEditor.focus(editor);
          editor.select(editor.start(path));
        }

        onClose();
      }}
      open={open}
      {...popoverProps}
    >
      <div data-testid={'controls-menu'} className={'flex w-[240px] flex-col p-2'}>
        {options.map((option) => {
          return (
            <Button
              data-testid={option.key}
              key={option.key}
              startIcon={option.icon}
              size={'small'}
              color={'inherit'}
              className={'justify-start'}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
                Promise.resolve(option.onClick()).catch((error) => {
                  notify.error(
                    error instanceof Error
                      ? error.message
                      : t('document.plugins.subPage.errors.failedDuplicatePage')
                  );
                });
              }}
            >
              {option.content}
            </Button>
          );
        })}

        {node?.[0]?.type &&
          [
            BlockType.Paragraph,
            BlockType.HeadingBlock,
            BlockType.BulletedListBlock,
            BlockType.NumberedListBlock,
            BlockType.QuoteBlock,
            BlockType.TodoListBlock,
            BlockType.ToggleListBlock,
          ].includes(node?.[0]?.type as BlockType) && (
            <>
              <Divider className='my-2' />
              <Color node={node[0] as BlockNode} onSelectColor={onClose} />
            </>
          )}

        {node?.[0]?.type === BlockType.OutlineBlock && onlySingleBlockSelected && (
          <>
            <Divider className='my-2' />
            <OutlineCollapseControl node={node[0] as OutlineNode} onToggle={onClose} />
            <OutlineDepthControl node={node[0] as OutlineNode} onClose={onClose} />
            <Color node={node[0] as BlockNode} onSelectColor={onClose} />
          </>
        )}

        {node?.[0]?.type === BlockType.CalloutBlock && (
          <>
            <Divider className='my-2' />
            <CalloutQuickStyleControl node={node[0] as CalloutNode} onSelectStyle={onClose} />
            <CalloutIconControl node={node[0] as CalloutNode} onSelectIcon={onClose} />
            <Color node={node[0] as BlockNode} onSelectColor={onClose} />
            <CalloutTextColor node={node[0] as CalloutNode} onSelectColor={onClose} />
          </>
        )}
      </div>
    </Popover>
  );
}

export default ControlsMenu;
