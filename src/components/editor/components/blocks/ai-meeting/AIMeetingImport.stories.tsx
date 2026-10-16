import MockAdapter from 'axios-mock-adapter';
import { useEffect, useMemo, useState } from 'react';
import { createEditor, Descendant, Node } from 'slate';
import { Slate, withReact } from 'slate-react';
import * as Y from 'yjs';

import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import {
  createBlock,
  getBlock,
  initializeDocumentStructure,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';
import { AIMeetingNode } from '@/components/editor/editor.type';
import { EditorContext, EditorContextState } from '@/components/editor/EditorContext';

import { withHostnameAndContexts } from '../../../../../../.storybook/decorators';

import { applyAudioTranscript, initializeMeetingSections } from './ai-meeting.import';
import { replaceBlockChildrenWithMarkdown } from './ai-meeting.summary-regenerate';
import { AIMeetingBlock } from './AIMeetingBlock';

import type { Meta, StoryObj } from '@storybook/react';

type PreviewState = 'welcome' | 'processing' | 'network-error' | 'limit' | 'ready' | 'summary';

function TranscriptPreview({ state = 'welcome', readOnly = false }: { state?: PreviewState; readOnly?: boolean }) {
  const fixture = useMemo(() => {
    initAPIService({
      baseURL: 'https://test.appflowy.cloud',
      gotrueURL: 'https://test.appflowy.cloud/gotrue',
      wsURL: 'wss://test.appflowy.cloud/ws',
    });
    const api = new MockAdapter(getAxios()!);

    api.onGet('/api/workspace/transcript-preview/usage-and-limit').reply(200, {
      code: 0,
      data: {
        ai_transcription_seconds: state === 'limit' ? 1800 : 120,
        ai_transcription_seconds_limit: 1800,
        single_upload_limit: 25 * 1024 * 1024,
        single_upload_unlimited: false,
      },
    });
    if (state === 'network-error') api.onGet(/get-transcript/).networkError();
    else api.onGet(/get-transcript/).reply(200, { code: 0, data: { id: 'preview-job', status: 'processing' } });
    api.onDelete(/delete-transcript/).reply(200, { code: 0 });
    const doc = new Y.Doc();

    initializeDocumentStructure(doc, false, 'transcript-preview');
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const editor = Object.assign(withReact(createEditor()), {
      sharedRoot,
      isElementReadOnly: () => readOnly,
    }) as YjsEditor;
    const meeting = createBlock(sharedRoot, {
      ty: BlockType.AIMeetingBlock,
      data: {
        title: state === 'ready' || state === 'summary'
          ? "JPMorgan's Dimon on Financing the AI Boom [FqiQfL9OBKY]"
          : state === 'processing' || state === 'network-error' ? 'Meeting @Today' : '',
        ...(state === 'processing' || state === 'network-error'
          ? {
              transcript_id: 'preview-job',
              transcription_type: 'audioFile',
              transcript_language: 'en',
              selected_tab_index: 1,
            }
          : {}),
      },
    });

    updateBlockParent(
      sharedRoot,
      meeting,
      getBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot),
      0
    );
    const id = meeting.get(YjsEditorKey.block_id);

    initializeMeetingSections(editor, id);
    if (state === 'ready' || state === 'summary') {
      const sections = traverseBlock(id, sharedRoot)!.children;
      const summaryId = 'blockId' in sections[0] ? sections[0].blockId : undefined;
      const transcriptId = 'blockId' in sections[2] ? sections[2].blockId : undefined;

      if (transcriptId) applyAudioTranscript(editor, id, transcriptId, {
        id: 'preview-job', text: 'The search button and shortcut need to be fixed.', segments: [
          { speaker: 'A', start: 403, end: 410, text: 'The search button and shortcut need to be fixed.' },
        ],
      });
      if (state === 'summary' && summaryId) replaceBlockChildrenWithMarkdown({
        editor, blockId: summaryId, markdown: '## Overview\n\nFix the search button and shortcut to open the search panel.',
      });
    }

    const node = traverseBlock(id, sharedRoot) as AIMeetingNode;
    const context = {
      workspaceId: 'transcript-preview',
      viewId: 'transcript-preview',
      readOnly,
      getSubscriptions: async () => [],
    } as EditorContextState;

    return { doc, editor, node, id, sharedRoot, context, api };
  }, [state, readOnly]);
  const [, refresh] = useState(0);

  useEffect(() => {
    const onChange = () => refresh((version) => version + 1);

    fixture.sharedRoot.observeDeep(onChange);
    return () => {
      fixture.sharedRoot.unobserveDeep(onChange);
      fixture.api.restore();
      fixture.doc.destroy();
    };
  }, [fixture]);

  const node = traverseBlock(fixture.id, fixture.sharedRoot) as AIMeetingNode;

  return (
    <div className='w-[720px] max-w-[calc(100vw-48px)]'>
      <Slate editor={fixture.editor} initialValue={[fixture.node] as Descendant[]}>
        <EditorContext.Provider value={fixture.context}>
          <AIMeetingBlock node={node}>
            {node.children.map((section) => (
              <div
                key={'blockId' in section ? section.blockId : ''}
                className='block-element whitespace-pre-wrap'
                data-block-type={'type' in section ? section.type : ''}
              >{'children' in section ? section.children.map(Node.string).join('\n\n') : Node.string(section)}</div>
            ))}
          </AIMeetingBlock>
        </EditorContext.Provider>
      </Slate>
    </div>
  );
}

const meta = {
  title: 'Editor/Blocks/AITranscriptImport',
  component: TranscriptPreview,
  parameters: { layout: 'centered' },
  decorators: [withHostnameAndContexts()],
} satisfies Meta<typeof TranscriptPreview>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Welcome: Story = { args: { state: 'welcome' } };
export const Processing: Story = { args: { state: 'processing' } };
export const NetworkError: Story = { args: { state: 'network-error' } };
export const LimitReached: Story = { args: { state: 'limit' } };
export const LockedPage: Story = { args: { state: 'welcome', readOnly: true } };
export const ReadyToGenerate: Story = { args: { state: 'ready' } };
export const SummaryReady: Story = { args: { state: 'summary' } };
