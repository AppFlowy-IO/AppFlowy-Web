import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';

import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { getDocument, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, PDFBlockData, YDoc, YjsEditorKey } from '@/application/types';
import { Editor } from '@/components/editor';

import { withContainer } from '../../../../../../.storybook/decorators';
import samplePDF from '../../../../../../playwright/fixtures/pdfs/sample.pdf?url';
import protectedPDF from '../../../../../../playwright/fixtures/pdfs/sample_with_password.pdf?url';

import { PDFBlock } from './PDFBlock';

import type { Meta, StoryObj } from '@storybook/react';
import '../../../editor.scss';

// Use the real editor so block menus, uploads and resize operate on document data.
function PDFStory({ data }: { data: PDFBlockData }) {
  const doc = useMemo(() => {
    const doc = new Y.Doc() as YDoc;

    initializeDocumentStructure(doc, true);
    const pageId = getDocument(doc.getMap(YjsEditorKey.data_section)).get(YjsEditorKey.page_id) as string;

    slateContentInsertToYData(
      pageId,
      0,
      [{ type: BlockType.PDFBlock, data, children: [{ type: 'text', children: [{ text: '' }] }] }],
      doc
    );
    return doc;
  }, [data]);

  useEffect(() => () => doc.destroy(), [doc]);
  return (
    <div className='w-[728px] max-w-full'>
      <Editor
        doc={doc}
        workspaceId='storybook-workspace'
        viewId='storybook-document'
        uploadFile={async () => samplePDF}
      />
    </div>
  );
}

const meta = {
  title: 'Editor/Blocks/PDFBlock',
  component: PDFBlock,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  render: ({ node }) => <PDFStory data={node.data} />,
  decorators: [withContainer({ padding: '20px', maxWidth: '800px' })],
  argTypes: {
    node: {
      description: 'The PDF block node',
      control: 'object',
    },
  },
} satisfies Meta<typeof PDFBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-1',
      children: [],
      data: {
        name: 'Project Proposal.pdf',
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const NoName: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-2',
      children: [],
      data: {
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const LongFilename: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-3',
      children: [],
      data: {
        name: 'Very Long Document Name That Should Wrap Properly in the UI Display Area Without Breaking Layout Q4 2025 Final Version.pdf',
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const ShortFilename: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-4',
      children: [],
      data: {
        name: 'Doc.pdf',
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const NoExtension: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-5',
      children: [],
      data: {
        name: 'Meeting Notes',
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const EmptyName: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-6',
      children: [],
      data: {
        name: '   ',
        url: samplePDF,
      },
    },
    children: [],
  },
};

export const NoURL: Story = {
  args: {
    node: {
      type: 'pdf',
      blockId: 'pdf-7',
      children: [],
      data: {
        name: 'Pending Upload.pdf',
      },
    },
    children: [],
  },
};

export const Protected: Story = {
  args: { ...Default.args, node: { ...Default.args!.node!, data: { url: protectedPDF } } },
};
