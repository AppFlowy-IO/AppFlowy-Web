import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Slate } from 'slate-react';
import { createEditor } from 'slate';
import { withContainer } from '../../../../../../.storybook/decorators';
import { PDFBlock } from './PDFBlock';
import { EditorContext } from '@/components/editor/EditorContext';
import { BlockPopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import '../../../editor.scss';

const mockEditorContext = {
  uploadFile: async (file: File) => {
    console.log('Mock upload:', file.name);
    return 'https://example.com/uploaded.pdf';
  },
  workspaceId: 'mock-workspace',
  viewId: 'mock-view',
};

const mockPopoverContext = {
  open: false,
  anchorEl: null,
  close: () => {
    // Mock close function
  },
  openPopover: (blockId: string, _type: unknown, _anchor: HTMLElement) => {
    console.log('Open popover for block:', blockId);
  },
  type: null,
  blockId: null,
};

// eslint-disable-next-line react/display-name
const WithEditorContexts = (Story: React.ComponentType) => {
  const editor = React.useMemo(() => createEditor(), []);
  const [value] = React.useState([
    {
      type: 'paragraph',
      children: [{ text: '' }],
    },
  ]);

  return (
    <Slate editor={editor} initialValue={value}>
      <EditorContext.Provider value={mockEditorContext as unknown}>
        <BlockPopoverContext.Provider value={mockPopoverContext}>
          <Story />
        </BlockPopoverContext.Provider>
      </EditorContext.Provider>
    </Slate>
  );
};

const meta = {
  title: 'Editor/Blocks/PDFBlock',
  component: PDFBlock,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [WithEditorContexts, withContainer({ padding: '20px', maxWidth: '800px' })],
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
        url: 'https://example.com/proposal.pdf',
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
        url: 'https://example.com/document.pdf',
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
        url: 'https://example.com/long-document.pdf',
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
        url: 'https://example.com/doc.pdf',
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
        url: 'https://example.com/notes.pdf',
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
        url: 'https://example.com/doc.pdf',
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
