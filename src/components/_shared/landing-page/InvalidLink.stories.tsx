import type { Meta, StoryObj } from '@storybook/react-vite';

import { withContextsMinimal } from '../../../../.storybook/decorators';

import { InvalidLink } from './InvalidLink';

const meta = {
  title: 'Landing Pages/InvalidLink',
  component: InvalidLink,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [withContextsMinimal],
  tags: ['autodocs'],
} satisfies Meta<typeof InvalidLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ExpiredMessage: Story = {
  args: {
    message: 'The invitation for Tom Workspace expired on 2024-05-01 10:00 UTC.',
  },
};

export const AlreadyAccepted: Story = {
  args: {
    message: 'This invitation was already accepted. Ask the workspace admin to send a new one.',
  },
};

export const Declined: Story = {
  args: {
    message: 'This invitation was declined earlier and can no longer be used.',
  },
};

export const DisabledLink: Story = {
  args: {
    message: 'This invite link was disabled by the workspace admin. Please request a new link.',
  },
};

export const NoActiveMembers: Story = {
  args: {
    message: 'Tom Workspace currently has no active members, so its invite link is disabled.',
  },
};
