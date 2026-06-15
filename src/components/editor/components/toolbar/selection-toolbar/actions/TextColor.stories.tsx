
import { SubscriptionPlan } from '@/application/types';

import { hostnameAndSubscriptionArgTypes } from '../../../../../../../.storybook/argTypes';

import type { Meta, StoryObj } from '@storybook/react-vite';

// Component to demonstrate Pro feature availability
// Note: This story uses a local isOfficialHost function, so it doesn't need to mock window.location.hostname
const ProFeatureDemo = ({ hostname, activeSubscriptionPlan }: { hostname: string; activeSubscriptionPlan: SubscriptionPlan | null }) => {

  // Simulate the logic from TextColor component
  const isOfficialHost = () => {
    return hostname === 'beta.appflowy.cloud' || hostname === 'test.appflowy.cloud';
  };

  const isPro = activeSubscriptionPlan === SubscriptionPlan.Pro || !isOfficialHost();
  const maxCustomColors = isPro ? 9 : 4;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h3 style={{ marginTop: 0 }}>Text Color Component - Pro Features</h3>
      <div style={{ marginBottom: '16px' }}>
        <strong>Hostname:</strong> {hostname}
      </div>
      <div style={{ marginBottom: '16px' }}>
        <strong>Active Plan:</strong> {activeSubscriptionPlan || 'None'}
      </div>
      <div style={{ marginBottom: '16px' }}>
        <strong>Is Official Host:</strong> {isOfficialHost() ? 'Yes' : 'No (Self-hosted)'}
      </div>
      <div style={{ marginBottom: '16px' }}>
        <strong>Pro Features Enabled:</strong> {isPro ? '✅ Yes' : '❌ No'}
      </div>
      <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <strong>Max Custom Colors:</strong> {maxCustomColors}
        <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
          {isPro
            ? 'Pro feature: Users can create up to 9 custom colors'
            : 'Free plan: Users can create up to 4 custom colors'}
        </div>
      </div>
      <div style={{ fontSize: '14px', color: '#666', marginTop: '16px', padding: '12px', backgroundColor: '#e8f4f8', borderRadius: '4px' }}>
        {!isOfficialHost() && (
          <div>
            <strong>ℹ️ Self-hosted:</strong> Pro features are enabled by default. Users get 9 custom colors without a Pro subscription.
          </div>
        )}
        {isOfficialHost() && !isPro && (
          <div>
            <strong>ℹ️ Official Host:</strong> Users need a Pro subscription to access 9 custom colors. Free plan users get 4 custom colors.
          </div>
        )}
        {isOfficialHost() && isPro && (
          <div>
            <strong>ℹ️ Official Host:</strong> User has Pro subscription, so they get 9 custom colors.
          </div>
        )}
      </div>
    </div>
  );
};

const meta = {
  title: 'Editor/TextColor - Pro Features',
  component: ProFeatureDemo,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: hostnameAndSubscriptionArgTypes,
} satisfies Meta<typeof ProFeatureDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHostFreePlan: Story = {
  args: {
    hostname: 'beta.appflowy.cloud',
    activeSubscriptionPlan: SubscriptionPlan.Free,
  },
  parameters: {
    docs: {
      description: {
        story: 'On official host with Free plan: Users get 4 custom colors (Free plan limit)',
      },
    },
  },
};

export const OfficialHostProPlan: Story = {
  args: {
    hostname: 'beta.appflowy.cloud',
    activeSubscriptionPlan: SubscriptionPlan.Pro,
  },
  parameters: {
    docs: {
      description: {
        story: 'On official host with Pro plan: Users get 9 custom colors (Pro feature)',
      },
    },
  },
};

export const SelfHostedFreePlan: Story = {
  args: {
    hostname: 'self-hosted.example.com',
    activeSubscriptionPlan: SubscriptionPlan.Free,
  },
  parameters: {
    docs: {
      description: {
        story: 'On self-hosted instance with Free plan: Users get 9 custom colors (Pro features enabled by default)',
      },
    },
  },
};

export const SelfHostedProPlan: Story = {
  args: {
    hostname: 'self-hosted.example.com',
    activeSubscriptionPlan: SubscriptionPlan.Pro,
  },
  parameters: {
    docs: {
      description: {
        story: 'On self-hosted instance: Pro features are always enabled regardless of subscription plan',
      },
    },
  },
};

export const TestHostFreePlan: Story = {
  args: {
    hostname: 'test.appflowy.cloud',
    activeSubscriptionPlan: SubscriptionPlan.Free,
  },
  parameters: {
    docs: {
      description: {
        story: 'On official test host with Free plan: Users get 4 custom colors (Free plan limit)',
      },
    },
  },
};

