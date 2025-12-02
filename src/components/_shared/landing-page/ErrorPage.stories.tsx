import type { Meta, StoryObj } from '@storybook/react-vite';

import { withContextsMinimal } from '../../../../.storybook/decorators';

import { ErrorPage } from './ErrorPage';

const meta = {
  title: 'Landing Pages/ErrorPage',
  component: ErrorPage,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [withContextsMinimal],
  tags: ['autodocs'],
} satisfies Meta<typeof ErrorPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRetry: Story = {
  args: {
    onRetry: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
  },
};

export const WithErrorDetails: Story = {
  args: {
    error: {
      code: 1012,
      message: 'You do not have permission to access this workspace.',
    },
    onRetry: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
  },
};

export const WithNetworkError: Story = {
  args: {
    error: {
      code: -1,
      message: 'Network error. Please check your connection.',
    },
    onRetry: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
  },
};

export const WithLongErrorMessage: Story = {
  args: {
    error: {
      code: 500,
      message: 'Internal server error: The request could not be processed due to an unexpected condition. Please try again later or contact support if the problem persists. Request ID: abc123-def456-ghi789',
    },
    onRetry: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
  },
};

export const WithErrorMessageOnly: Story = {
  args: {
    error: {
      message: 'Something unexpected happened.',
    },
  },
};
