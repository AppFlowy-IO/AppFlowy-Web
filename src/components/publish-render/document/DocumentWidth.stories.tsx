import { DocumentWidth } from '@/application/document-width';
import { publishedDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import AppTheme from '@/components/main/AppTheme';
import { TooltipProvider } from '@/components/ui/tooltip';

import { withContexts } from '../../../../.storybook/decorators';

import PublishedDocumentRenderer from './PublishedDocumentRenderer';

import type { Meta, StoryObj } from '@storybook/react';

function WidthPreview({ width }: { width?: DocumentWidth }) {
  const snapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);

  if (snapshot.kind !== 'document') throw new Error('Expected document fixture');
  snapshot.view.extra = JSON.stringify({
    ...JSON.parse(snapshot.view.extra || '{}'),
    document_width: width,
  });

  return <AppTheme><TooltipProvider><PublishedDocumentRenderer snapshot={snapshot} /></TooltipProvider></AppTheme>;
}

const meta = {
  title: 'Document/Width',
  component: WidthPreview,
  decorators: [withContexts],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WidthPreview>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: {} };
export const Full: Story = { args: { width: { mode: 'full' } } };
export const Fixed: Story = { args: { width: { mode: 'fixed', max_width: 1200 } } };
