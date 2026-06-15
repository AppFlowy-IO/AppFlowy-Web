
import { SubscriptionPlan, View } from '@/application/types';

import { activePlanArgType, hostnameArgType, isOwnerArgType } from '../../../../.storybook/argTypes';
import { withHostnameMocking, withContainer } from '../../../../.storybook/decorators';

import HomePageSetting from './HomePageSetting';

import type { Meta, StoryObj } from '@storybook/react-vite';

const mockView: View = {
  view_id: 'test-view-id',
  name: 'Test Page',
  icon: { ty: 0, value: '📄' },
  layout: 0,
  created_at: Date.now(),
  modified_at: Date.now(),
  created_by: 'test-user',
  parent_view_id: '',
  parent_id: '',
  data: {},
};

const mockPublishViews: View[] = [
  mockView,
  {
    ...mockView,
    view_id: 'test-view-id-2',
    name: 'Another Page',
  },
];

const meta = {
  title: 'Publish/HomePageSetting',
  component: HomePageSetting,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    withHostnameMocking(),
    withContainer({ maxWidth: '600px' }),
  ],
  argTypes: {
    ...activePlanArgType,
    ...isOwnerArgType,
    ...hostnameArgType,
  },
} satisfies Meta<typeof HomePageSetting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHostFreePlan: Story = {
  args: {
    activePlan: SubscriptionPlan.Free,
    isOwner: true,
    hostname: 'beta.appflowy.cloud',
    homePage: undefined,
    publishViews: mockPublishViews,
    onRemoveHomePage: async () => {
      // Mock implementation
    },
    onUpdateHomePage: async () => {
      // Mock implementation
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows upgrade button on official host when user has Free plan and wants to set homepage',
      },
    },
  },
};

export const OfficialHostProPlan: Story = {
  args: {
    activePlan: SubscriptionPlan.Pro,
    isOwner: true,
    hostname: 'beta.appflowy.cloud',
    homePage: mockView,
    publishViews: mockPublishViews,
    onRemoveHomePage: async () => {
      // Mock implementation
    },
    onUpdateHomePage: async () => {
      // Mock implementation
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows homepage selector on official host when user has Pro plan',
      },
    },
  },
};

export const SelfHostedFreePlan: Story = {
  args: {
    activePlan: SubscriptionPlan.Free,
    isOwner: true,
    hostname: 'self-hosted.example.com',
    homePage: undefined,
    publishViews: mockPublishViews,
    onRemoveHomePage: async () => {
      // Mock implementation
    },
    onUpdateHomePage: async () => {
      // Mock implementation
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'On self-hosted instances, homepage feature is available even with Free plan (Pro features enabled by default). No upgrade button shown.',
      },
    },
  },
};

export const SelfHostedProPlan: Story = {
  args: {
    activePlan: SubscriptionPlan.Pro,
    isOwner: true,
    hostname: 'self-hosted.example.com',
    homePage: mockView,
    publishViews: mockPublishViews,
    onRemoveHomePage: async () => {
      // Mock implementation
    },
    onUpdateHomePage: async () => {
      // Mock implementation
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'On self-hosted instances, homepage feature works the same as Pro plan (Pro features enabled by default)',
      },
    },
  },
};

export const NotOwner: Story = {
  args: {
    activePlan: SubscriptionPlan.Free,
    isOwner: false,
    hostname: 'beta.appflowy.cloud',
    homePage: mockView,
    publishViews: mockPublishViews,
    onRemoveHomePage: async () => {
      // Mock implementation
    },
    onUpdateHomePage: async () => {
      // Mock implementation
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Non-owner users can view but not modify homepage settings',
      },
    },
  },
};

