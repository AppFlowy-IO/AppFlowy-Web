import { useMemo, useState } from 'react';

import { mockDashboardContextValue } from '../../../../.storybook/dashboard-mocks';

import { DashboardContext } from './DashboardContext';
import { DashboardEmptyState } from './DashboardEmptyState';

import type { Meta, StoryObj } from '@storybook/react-vite';

function EmptyDashboardPreview({ editing = false, readOnly = false }) {
  const [isEditing, setEditing] = useState(editing);
  const value = useMemo(
    () => ({ ...mockDashboardContextValue, isEditing, setEditing, canEdit: !readOnly, canEnterEdit: !readOnly }),
    [isEditing, readOnly]
  );

  return (
    <DashboardContext.Provider value={value}>
      <div className='min-h-[480px] w-full bg-background-primary p-6 text-text-primary'>
        <DashboardEmptyState onNewView={() => undefined} />
      </div>
    </DashboardContext.Provider>
  );
}

const meta = {
  title: 'Database/Dashboard/Empty state',
  component: EmptyDashboardPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmptyDashboardPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const View: Story = {};
export const Edit: Story = { args: { editing: true } };
export const ReadOnly: Story = { args: { readOnly: true } };
