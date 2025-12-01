import type { Meta, StoryObj } from '@storybook/react';
import { withContainer } from '../../../../../../.storybook/decorators';
import { AIMeetingBlock } from './AIMeetingBlock';
import '../../../editor.scss';

const meta = {
  title: 'Editor/Blocks/AIMeetingBlock',
  component: AIMeetingBlock,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [withContainer({ padding: '20px', maxWidth: '800px' })],
  argTypes: {
    node: {
      description: 'The AI Meeting block node',
      control: 'object',
    },
  },
} satisfies Meta<typeof AIMeetingBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    node: {
      type: 'ai_meeting',
      blockId: 'ai-meeting-1',
      children: [],
      data: {
        title: 'Weekly Team Sync',
      },
    },
    children: [],
  },
};

export const NoTitle: Story = {
  args: {
    node: {
      type: 'ai_meeting',
      blockId: 'ai-meeting-2',
      children: [],
      data: {},
    },
    children: [],
  },
};

export const LongTitle: Story = {
  args: {
    node: {
      type: 'ai_meeting',
      blockId: 'ai-meeting-3',
      children: [],
      data: {
        title: 'Quarterly Business Review Meeting with All Stakeholders and Department Heads - Q4 2025',
      },
    },
    children: [],
  },
};

export const ShortTitle: Story = {
  args: {
    node: {
      type: 'ai_meeting',
      blockId: 'ai-meeting-4',
      children: [],
      data: {
        title: 'Standup',
      },
    },
    children: [],
  },
};

export const EmptyTitle: Story = {
  args: {
    node: {
      type: 'ai_meeting',
      blockId: 'ai-meeting-5',
      children: [],
      data: {
        title: '   ',
      },
    },
    children: [],
  },
};
