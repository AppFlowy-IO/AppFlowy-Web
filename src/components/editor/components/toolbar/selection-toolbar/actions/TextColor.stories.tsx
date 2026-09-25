import { useCallback, useEffect } from 'react';

import { defaultConfig } from '@/application/services/js-services/http/cloud-config';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { updateServerInfo } from '@/utils/server-info';

import { subscriptionPlanArgType } from '../../../../../../../.storybook/argTypes';

import type { Meta, StoryObj } from '@storybook/react-vite';

// Exercise the same server-info policy and subscription gate as TextColor.
const ProFeatureDemo = ({
  selfHosted,
  activeSubscriptionPlan,
}: {
  selfHosted: boolean;
  activeSubscriptionPlan: SubscriptionPlan | null;
}) => {
  useEffect(() => {
    updateServerInfo(defaultConfig.baseURL, {
      status: 'available',
      info: { enable_page_history: true, self_hosted: selfHosted },
    });
    return () => updateServerInfo(defaultConfig.baseURL, { status: 'loading' });
  }, [selfHosted]);
  const getSubscriptions = useCallback(
    async () =>
      activeSubscriptionPlan
        ? [
            {
              plan: activeSubscriptionPlan,
              price_cents: 1000,
              currency: 'USD',
              recurring_interval: SubscriptionInterval.Month,
            },
          ]
        : [],
    [activeSubscriptionPlan]
  );
  const isOfficial = useIsOfficialHosted();
  const { isPro } = useSubscriptionPlan(getSubscriptions);
  const maxCustomColors = isPro ? 9 : 4;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h3 style={{ marginTop: 0 }}>Text Color Component - Pro Features</h3>
      <div style={{ marginBottom: '16px' }}>
        <strong>Self-hosted server:</strong> {selfHosted ? 'Yes' : 'No'}
      </div>
      <div style={{ marginBottom: '16px' }}>
        <strong>Active Plan:</strong> {activeSubscriptionPlan || 'None'}
      </div>
      <div style={{ marginBottom: '16px' }}>
        <strong>Is Official Host:</strong> {isOfficial ? 'Yes' : 'No (Self-hosted)'}
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
      <div
        style={{
          fontSize: '14px',
          color: '#666',
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#e8f4f8',
          borderRadius: '4px',
        }}
      >
        {!isOfficial && (
          <div>
            <strong>ℹ️ Self-hosted:</strong> Pro features are enabled by default. Users get 9 custom colors without a Pro
            subscription.
          </div>
        )}
        {isOfficial && !isPro && (
          <div>
            <strong>ℹ️ Official Host:</strong> Users need a Pro subscription to access 9 custom colors. Free plan users
            get 4 custom colors.
          </div>
        )}
        {isOfficial && isPro && (
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
  argTypes: {
    ...subscriptionPlanArgType,
    selfHosted: { control: 'boolean', description: 'Server-provided self_hosted flag' },
  },
} satisfies Meta<typeof ProFeatureDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHostFreePlan: Story = {
  args: {
    selfHosted: false,
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
    selfHosted: false,
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
    selfHosted: true,
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
    selfHosted: true,
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
