
import { SubscriptionPlan } from '@/application/types';

import { hostnameAndSubscriptionArgTypes } from '../../../../.storybook/argTypes';
import { withHostnameAndContexts } from '../../../../.storybook/decorators';

import { UpgradeBanner } from './UpgradeBanner';

import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Share/UpgradeBanner',
  component: UpgradeBanner,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    withHostnameAndContexts({ maxWidth: '600px', minimalAFConfig: true }),
  ],
  argTypes: hostnameAndSubscriptionArgTypes,
} satisfies Meta<typeof UpgradeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHostFreePlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Free,
    hostname: 'beta.appflowy.cloud',
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows upgrade banner on official host (beta.appflowy.cloud) when user has Free plan',
      },
    },
  },
};

export const OfficialHostProPlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Pro,
    hostname: 'beta.appflowy.cloud',
  },
  parameters: {
    docs: {
      description: {
        story: 'No banner shown on official host when user already has Pro plan',
      },
    },
  },
};

export const SelfHostedFreePlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Free,
    hostname: 'self-hosted.example.com',
  },
  parameters: {
    docs: {
      description: {
        story: 'No banner shown on self-hosted instance - Pro features are enabled by default',
      },
    },
  },
};

export const SelfHostedProPlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Pro,
    hostname: 'self-hosted.example.com',
  },
  parameters: {
    docs: {
      description: {
        story: 'No banner shown on self-hosted instance - Pro features are enabled by default',
      },
    },
  },
};

