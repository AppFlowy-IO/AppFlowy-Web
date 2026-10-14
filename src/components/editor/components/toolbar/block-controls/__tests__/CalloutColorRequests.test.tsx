import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BlockType, SubscriptionPlan, YjsEditorKey } from '@/application/types';
import { CalloutNode } from '@/components/editor/editor.type';
import { TooltipProvider } from '@/components/ui/tooltip';

import CalloutTextColor from '../CalloutTextColor';
import Color from '../Color';

import type { ReactNode } from 'react';

const mockGetSubscriptions = jest.fn(async () => [{ plan: SubscriptionPlan.Pro }]);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => ({}) }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: 'color-request-test', getSubscriptions: mockGetSubscriptions }),
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useServerHostingMode: () => 'cloud',
  useServerInfoState: () => ({ status: 'available' }),
}));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));

it('loads the plan only when a palette opens and shares it between both palettes', async () => {
  const node = {
    blockId: 'callout',
    type: BlockType.CalloutBlock,
    data: {},
    children: [{ type: YjsEditorKey.text, children: [{ text: 'Callout' }] }],
  } as CalloutNode;

  render(
    <TooltipProvider>
      <CalloutTextColor node={node} onSelectColor={jest.fn()} />
      <Color node={node} onSelectColor={jest.fn()} />
    </TooltipProvider>
  );
  expect(mockGetSubscriptions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'editor.textColor' }));
  await waitFor(() => expect(mockGetSubscriptions).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: 'colors.lavender' });
  fireEvent.click(screen.getByRole('button', { name: 'editor.backgroundColor' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'colors.lavender' })).toHaveLength(2));
  expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
});
