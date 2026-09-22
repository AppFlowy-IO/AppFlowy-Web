import React, { useMemo, useState } from 'react';

import { PricingCatalog } from '@/application/types';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import { AFConfigContext } from '@/components/main/app.hooks';

import { openArgType } from '../../../.storybook/argTypes';
import {
  mockAFConfigValue,
  mockAuthInternalValue,
  mockOperationsValue,
  mockPricingCatalog,
} from '../../../.storybook/mocks';

import UpgradePlan from './UpgradePlan';

import type { Meta, StoryObj } from '@storybook/react-vite';

type PricingState = 'ready' | 'loading' | 'error';

interface StoryArgs {
  open?: boolean;
  isOfficialHosted?: boolean;
  pricing?: PricingState;
}

function pricingFetcher(state: PricingState): () => Promise<PricingCatalog> {
  switch (state) {
    case 'loading':
      return () => new Promise<PricingCatalog>(() => undefined);
    case 'error':
      return async () => {
        throw new Error('Billing service unavailable');
      };

    default:
      return async () => mockPricingCatalog;
  }
}

const meta = {
  title: 'Billing/UpgradePlan',
  component: UpgradePlan,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story: React.ComponentType, context: { args: StoryArgs }) => {
      const pricing = context.args.pricing ?? 'ready';
      const isOfficialHosted = context.args.isOfficialHosted ?? true;
      const [open, setOpen] = useState(context.args.open ?? false);
      // The catalog store is module-global; start every pricing state from a cold cache.
      const getPricingCatalog = useMemo(() => {
        resetPricingCatalogCache();
        return pricingFetcher(pricing);
      }, [pricing]);

      return (
        <AFConfigContext.Provider value={mockAFConfigValue}>
          <AuthInternalContext.Provider value={{ ...mockAuthInternalValue, isOfficialHosted }}>
            <AppOperationsContext.Provider value={{ ...mockOperationsValue, getPricingCatalog }}>
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
            </AppOperationsContext.Provider>
          </AuthInternalContext.Provider>
        </AFConfigContext.Provider>
      );
    },
  ],
  argTypes: {
    ...openArgType,
    isOfficialHosted: {
      control: 'boolean',
      description: 'Whether /api/server-info reported self_hosted: false (the app only mounts this modal when true)',
      table: {
        category: 'Testing',
        defaultValue: { summary: 'true' },
      },
    },
    pricing: {
      control: 'select',
      options: ['ready', 'loading', 'error'],
      description: 'Simulated state of GET /billing/api/v1/pricing',
      table: {
        category: 'Testing',
        defaultValue: { summary: 'ready' },
      },
    },
  },
} satisfies Meta<typeof UpgradePlan>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHost: Story = {
  args: {
    open: true,
    isOfficialHosted: true,
    pricing: 'ready',
  },
  parameters: {
    docs: {
      description: {
        story: 'Free and Pro cards rendered from the billing pricing catalog. Users can upgrade to the Pro plan.',
      },
    },
  },
};

export const SelfHosted: Story = {
  args: {
    open: true,
    isOfficialHosted: false,
    pricing: 'ready',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The app never mounts this modal for self-hosted servers. If it were mounted, paid plans are hidden because Pro features are enabled by default.',
      },
    },
  },
};

export const Loading: Story = {
  args: {
    open: true,
    isOfficialHosted: true,
    pricing: 'loading',
  },
  parameters: {
    docs: {
      description: {
        story: 'Skeleton cards while the pricing catalog request is in flight.',
      },
    },
  },
};

export const PricingUnavailable: Story = {
  args: {
    open: true,
    isOfficialHosted: true,
    pricing: 'error',
  },
  parameters: {
    docs: {
      description: {
        story: 'The billing service could not be reached; the modal offers a retry instead of stale hardcoded prices.',
      },
    },
  },
};
