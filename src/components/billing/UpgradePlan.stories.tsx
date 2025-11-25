import React, { useState } from 'react';

import { AppContext } from '@/components/app/app.hooks';
import { AFConfigContext } from '@/components/main/app.hooks';

import { hostnameArgType, openArgType } from '../../../.storybook/argTypes';
import { useHostnameMock } from '../../../.storybook/decorators';
import { mockAFConfigValue, mockAppContextValue } from '../../../.storybook/mocks';

import UpgradePlan from './UpgradePlan';

import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Billing/UpgradePlan',
  component: UpgradePlan,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story: React.ComponentType, context: { args: { hostname?: string; open?: boolean } }) => {
      const hostname = context.args.hostname || 'beta.appflowy.cloud';
      const [open, setOpen] = useState(context.args.open ?? false);

      useHostnameMock(hostname);

      return (
        <AFConfigContext.Provider value={mockAFConfigValue}>
          <AppContext.Provider value={mockAppContextValue}>
            <div style={{ padding: '20px', width: '100%', maxWidth: '800px' }}>
              <button
                onClick={() => setOpen(true)}
                style={{
                  marginBottom: '20px',
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Open Upgrade Plan Modal
              </button>
              <Story args={{ ...context.args, open, onClose: () => setOpen(false), onOpen: () => setOpen(true) }} />
            </div>
          </AppContext.Provider>
        </AFConfigContext.Provider>
      );
    },
  ],
  argTypes: {
    ...openArgType,
    ...hostnameArgType,
  },
} satisfies Meta<typeof UpgradePlan>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHost: Story = {
  args: {
    open: true,
    hostname: 'beta.appflowy.cloud',
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows both Free and Pro plans on official host (beta.appflowy.cloud). Users can upgrade to Pro plan.',
      },
    },
  },
};

export const SelfHosted: Story = {
  args: {
    open: true,
    hostname: 'self-hosted.example.com',
  },
  parameters: {
    docs: {
      description: {
        story: 'On self-hosted instances, Pro plan is hidden. Pro features are enabled by default without subscription.',
      },
    },
  },
};
