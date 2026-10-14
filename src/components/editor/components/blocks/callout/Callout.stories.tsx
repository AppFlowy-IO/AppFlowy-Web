import { useEffect, useState } from 'react';
import { Element } from 'slate';

import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { createEmptyDocument, getPageId } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc, YjsEditorKey, YSharedRoot } from '@/application/types';
import { Editor } from '@/components/editor/Editor';
import AppTheme from '@/components/main/AppTheme';
import { TooltipProvider } from '@/components/ui/tooltip';

import { withContexts } from '../../../../../../.storybook/decorators';

import { DEFAULT_CALLOUT_DATA, MORE_STYLE_OPTIONS, QUICK_STYLE_OPTIONS, calloutPresetData } from './callout.utils';

import type { Meta, StoryObj } from '@storybook/react';

function textBlock(type: BlockType, text: string, data = {}, children: Element[] = []): Element {
  return { type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children] } as Element;
}

function CalloutPlayground({ readOnly = false, presets = false }: { readOnly?: boolean; presets?: boolean }) {
  const [doc] = useState(() => {
    const document = createEmptyDocument();
    const pageId = getPageId(document.getMap(YjsEditorKey.data_section) as YSharedRoot);
    const blocks = presets
      ? [...QUICK_STYLE_OPTIONS, ...MORE_STYLE_OPTIONS].map((preset) =>
          textBlock(
            BlockType.CalloutBlock,
            `${preset.key}: A callout is a highlighted piece of text used to grab a reader’s attention.`,
            calloutPresetData(preset)
          )
        )
      : [
          textBlock(BlockType.CalloutBlock, 'Hello World', DEFAULT_CALLOUT_DATA),
          textBlock(BlockType.CalloutBlock, 'A callout without an icon.', { icon: '', version: 1 }, [
            textBlock(BlockType.Paragraph, 'Nested text stays aligned.'),
          ]),
          textBlock(BlockType.CalloutBlock, '', DEFAULT_CALLOUT_DATA),
          textBlock(BlockType.Paragraph, 'Following paragraph'),
        ];

    slateContentInsertToYData(pageId, 0, blocks, document);
    return document as YDoc;
  });

  useEffect(() => {
    // Tailwind is scoped to #body in the app; editor menus portal to document.body.
    const storyRoot = document.getElementById('body');
    const bodyId = document.body.id;

    if (storyRoot !== document.body) storyRoot?.removeAttribute('id');
    document.body.id = 'body';
    return () => {
      document.body.id = bodyId;
      if (storyRoot !== document.body) storyRoot?.setAttribute('id', 'body');
      doc.destroy();
    };
  }, [doc]);

  return (
    <AppTheme>
      <TooltipProvider>
        <div className='h-screen overflow-auto bg-surface-layer-01 py-10 text-text-primary'>
          <Editor
            doc={doc}
            viewId='callout-playground'
            workspaceId='callout-playground'
            readOnly={readOnly}
            fullWidth
            uploadFile={async (file) =>
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              })
            }
          />
        </div>
      </TooltipProvider>
    </AppTheme>
  );
}

const meta = {
  title: 'Editor/Blocks/Callout',
  component: CalloutPlayground,
  decorators: [withContexts],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CalloutPlayground>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Editing: Story = { args: {} };
export const Presets: Story = { args: { presets: true } };
export const ReadOnly: Story = { args: { readOnly: true, presets: true } };
