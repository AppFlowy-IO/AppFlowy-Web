import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Text } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { APP_EVENTS } from '@/application/constants';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { getBlocks } from '@/application/slate-yjs/utils/yjs';
import { MentionType, View, ViewLayout, YjsEditorKey, YSharedRoot } from '@/application/types';
import { ReactComponent as LinkArrowOverlay } from '@/assets/icons/link_arrow.svg';
import { ReactComponent as ParagraphIcon } from '@/assets/icons/paragraph.svg';
import { findView } from '@/components/_shared/outline/utils';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useEditorContext } from '@/components/editor/EditorContext';

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
  const [metadata, setMetadata] = useState<{ pageId: string; view: View | null; noAccess: boolean } | null>(null);
  // Keep the current page visible while revalidating, without showing the
  // previous page's metadata when this component receives a new reference.
  const meta = metadata?.pageId === pageId ? metadata.view : null;
  const noAccess = metadata?.pageId === pageId && metadata.noAccess;
  const [externalBlock, setExternalBlock] = useState<{ pageId: string; blockId: string; text: string }>();

  useEffect(() => {
    let current = true;
    let receivedUpdate = false;

    const acceptView = (view: View | null) => {
      setMetadata({ pageId, view, noAccess: false });
      onPageMentionNameResolved?.(pageId, view?.name);
    };

    const handleView = (view: View) => {
      if (view.view_id !== pageId) return;
      receivedUpdate = true;
      acceptView(view);
    };

    const handleOutlineLoaded = (outline: View[]) => {
      const view = findView(outline, pageId);

      if (view) handleView(view);
    };

    eventEmitter?.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    eventEmitter?.on(APP_EVENTS.VIEW_META_CHANGED, handleView);
    void loadViewMeta?.(pageId).then((view) => {
      if (current && !receivedUpdate) acceptView(view);
    }).catch(() => {
      if (current && !receivedUpdate) {
        setMetadata((previous) => ({
          pageId,
          view: previous?.pageId === pageId ? previous.view : null,
          noAccess: true,
        }));
      }
    });
    return () => {
      current = false;
      eventEmitter?.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
      eventEmitter?.off(APP_EVENTS.VIEW_META_CHANGED, handleView);
    };
  }, [eventEmitter, loadViewMeta, onPageMentionNameResolved, pageId]);

  const icon = meta?.icon;
  const { t } = useTranslation();
  const currentBlock = blockId && currentViewId === pageId
    ? findSlateEntryByBlockId(editor as YjsEditor, blockId)
    : undefined;
  const currentBlockText = currentBlock ? CustomEditor.getBlockTextContent(currentBlock[0], 2) : undefined;
  const pageName = meta?.name || t('menuAppHeader.defaultNewPageName');
  const externalBlockText = externalBlock?.pageId === pageId && externalBlock.blockId === blockId
    ? externalBlock.text
    : '';
  const content = currentViewId === pageId
    ? currentBlockText || pageName
    : `${pageName}${externalBlockText ? ` - ${externalBlockText}` : ''}`;

  useEffect(() => {
    if (!blockId || currentViewId === pageId) return;
    let current = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
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
      }
    })();

    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [blockId, currentViewId, loadView, pageId]);

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
        if (noAccess) return;

        // Same-page block reference: scroll to the target block
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
        cursor: noAccess ? 'default' : undefined,
      }}
      className={`mention-inline cursor-pointer pr-1 underline select-none`}
      contentEditable={false}
      data-mention-id={pageId}
    >
      {noAccess ? (
        <span className={'mention-unpublished font-semibold text-text-secondary'}>{t('document.mention.noAccess')}</span>
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
