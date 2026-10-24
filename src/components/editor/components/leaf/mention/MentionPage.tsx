import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Text } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { getBlocks } from '@/application/slate-yjs/utils/yjs';
import { MentionType, ViewLayout, YjsEditorKey, YSharedRoot } from '@/application/types';
import { ReactComponent as LinkArrowOverlay } from '@/assets/icons/link_arrow.svg';
import { ReactComponent as ParagraphIcon } from '@/assets/icons/paragraph.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useEditorContext } from '@/components/editor/EditorContext';

import { PageReferenceError } from './PageReferenceError';
import { usePageReferenceMetadata } from './usePageReferenceMetadata';

import './style.css';

function MentionPage({
  pageId,
  blockId,
  type,
}: {
  text: Text | Element;
  pageId: string;
  blockId?: string;
  type?: MentionType;
}) {
  const context = useEditorContext();
  const editor = useSlate();
  const currentViewId = context.viewId;
  const eventEmitter = context.eventEmitter;

  const { navigateToView, loadViewMeta, loadView, onPageMentionNameResolved } = context;
  const { view: meta, error: metadataError, loading, accessRevision, retry } = usePageReferenceMetadata({
    pageId,
    loadViewMeta,
    eventEmitter,
    onPageMentionNameResolved,
  });
  const [externalBlock, setExternalBlock] = useState<{ pageId: string; blockId: string; text: string }>();
  const metadataAvailable = Boolean(meta) && metadataError === null;

  const icon = meta?.icon;
  const { t } = useTranslation();
  const currentBlock = blockId && currentViewId === pageId
    ? findSlateEntryByBlockId(editor as YjsEditor, blockId)
    : undefined;
  const currentBlockText = currentBlock ? CustomEditor.getBlockTextContent(currentBlock[0], 2) : undefined;
  // The open editor already owns this block's readable content. A separate
  // metadata failure must not hide it (including in detached editor surfaces).
  const hasCurrentBlockContent = Boolean(currentBlockText);
  const error = hasCurrentBlockContent ? null : metadataError;
  const pageName = meta?.name || t('menuAppHeader.defaultNewPageName');
  const externalBlockText = externalBlock?.pageId === pageId && externalBlock.blockId === blockId
    ? externalBlock.text
    : '';
  const content = currentViewId === pageId
    ? currentBlockText || pageName
    : `${pageName}${externalBlockText ? ` - ${externalBlockText}` : ''}`;

  // Recovery reloads the document; renames and unrelated outline updates keep
  // the same availability/revision and retain the existing subscription.
  useEffect(() => {
    if (!blockId || currentViewId === pageId) return;
    setExternalBlock(undefined);
    if (!metadataAvailable) return;
    let current = true;
    let unsubscribe: (() => void) | undefined;

    const loadBlock = async () => {
      try {
        const otherDoc = await loadView?.(pageId);

        if (!current || !otherDoc) return;
        const sharedRoot = otherDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const handleBlockChange = () => {
          if (!current) return;
          const node = getBlocks(sharedRoot).has(blockId) ? traverseBlock(blockId, sharedRoot) : undefined;
          const text = node ? CustomEditor.getBlockTextContent(node, 2) : '';

          setExternalBlock((previous) => previous?.pageId === pageId && previous.blockId === blockId && previous.text === text
            ? previous
            : { pageId, blockId, text });
        };

        sharedRoot.observeDeep(handleBlockChange);
        unsubscribe = () => sharedRoot.unobserveDeep(handleBlockChange);
        handleBlockChange();
      } catch {
        // The page title remains available if the referenced document cannot load.
        unsubscribe?.();
        unsubscribe = undefined;
      }
    };

    void loadBlock();

    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [accessRevision, blockId, currentViewId, loadView, metadataAvailable, pageId]);

  const mentionIcon = useMemo(() => {
    if (pageId === currentViewId && blockId) {
      return <ParagraphIcon className={'h-[1.25em] w-[1.25em] text-icon-primary opacity-70'} />;
    }

    return (
      <>
        <PageIcon
          view={{
            icon: icon,
            layout: meta?.layout || ViewLayout.Document,
          }}
          className={'ml-0.5 flex h-[1.25em] w-[1.25em] items-center text-text-primary'}
        />

        {type === MentionType.PageRef && (
          <span className={`absolute left-0 top-0 ml-0.5 `}>
            <LinkArrowOverlay className={' link-arrow-overlay h-[1.25em] w-[1.25em]'} />
          </span>
        )}
      </>
    );
  }, [blockId, currentViewId, icon, meta?.layout, pageId, type]);

  const handleScrollToBlock = useCallback(async () => {
    if (blockId) {
      const entry = findSlateEntryByBlockId(editor as YjsEditor, blockId);

      if (entry) {
        const [node] = entry;
        const dom = ReactEditor.toDOMNode(editor, node);

        await smoothScrollIntoViewIfNeeded(dom, {
          behavior: 'smooth',
          scrollMode: 'if-needed',
        });

        dom.className += ' highlight-block';
        setTimeout(() => {
          dom.className = dom.className.replace('highlight-block', '');
        }, 5000);
      }
    }
  }, [blockId, editor]);

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();

        // Same-page block reference: scroll to the target block
        if (hasCurrentBlockContent) {
          void handleScrollToBlock();
          return;
        }

        if (error || !meta) return;
        if (pageId === currentViewId) {
          void handleScrollToBlock();
          return;
        }

        // Navigate directly to the target view (matches desktop behavior,
        // which always opens mentions in a new tab regardless of layout type).
        // Deferred so Slate's event cycle completes before the route change
        // unmounts the editor.
        setTimeout(() => {
          void navigateToView?.(pageId, blockId);
        }, 0);
      }}
      style={{
        cursor: error || (!meta && !hasCurrentBlockContent) ? 'default' : undefined,
      }}
      className={`mention-inline cursor-pointer pr-1 underline select-none`}
      contentEditable={false}
      data-mention-id={pageId}
    >
      {error ? (
        <PageReferenceError
          key={`${pageId}:${error}`}
          pageId={pageId}
          error={error}
          loading={loading}
          retry={retry}
          loadTrashViews={context.loadTrashViews}
        />
      ) : (
        <>
          <span className={`mention-icon`}>{mentionIcon}</span>

          <span className={'mention-content max-w-[330px] truncate opacity-80'}>{content}</span>
        </>
      )}
    </span>
  );
}

export default MentionPage;
