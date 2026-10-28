import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import SlidesWorkflow from '../SlidesWorkflow';
import { PresentationAPIError } from '../presentation-client';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';

jest.mock('../ServerSlideCanvas', () => ({
  __esModule: true,
  default: () => <div>Server scene</div>,
  ServerSlideSceneProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../SlideGenerationSetup', () => ({ __esModule: true, default: () => null }));
jest.mock('../FullscreenControl', () => ({ __esModule: true, default: () => null }));
jest.mock('../presentation-client', () => ({
  PresentationAPIError: class extends Error {
    constructor(message: string, _code: string, public status: number) { super(message); }
  },
}));
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('../ui', () => ({
  Action: ({
    children,
    primary: _primary,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) => <button {...props}>{children}</button>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SourceLinks: () => null,
}));

function props(download: jest.Mock, id = 'deck-one'): SlidesWorkflowProps {
  const source = {
    pageId: 'page',
    title: 'Page',
    revision: 'revision',
    kind: 'document' as const,
    blocks: [],
    properties: [],
    warnings: [],
  };
  const style = {
    id: 'theme',
    name: 'Theme',
    description: '',
    color: '#000000',
    background: '#ffffff',
    font: 'Arial',
    footer: '',
    guidelines: '',
  };
  const plan = {
    title: 'Deck',
    slides: [
      {
        id: 'slide',
        title: 'Title',
        message: 'Message',
        layout: 'title' as const,
        points: [],
        sourceIds: ['page'],
        notes: '',
        warnings: [],
      },
    ],
  };

  return {
    snapshot: source,
    options: { audience: '', slideCount: 4, instructions: '', includeProperties: false, allowWebSearch: false },
    onOptions: jest.fn(),
    styles: [style],
    style,
    onStyle: jest.fn(),
    plan,
    onPlan: jest.fn(),
    stage: 'preview',
    onStage: jest.fn(),
    onGenerate: jest.fn(),
    onSource: jest.fn(),
    onApplyOutline: jest.fn(),
    hasOutlineChanges: false,
    onDiscardOutline: jest.fn(),
    decks: [],
    onOpenDeck: jest.fn(),
    onStyles: jest.fn(),
    canGenerate: true,
    canEdit: true,
    onUpgrade: jest.fn(),
    sourceChanged: false,
    hasNarrative: false,
    origin: 'Saved',
    exportReady: true,
    onDownload: download,
    scope: { workspaceId: 'workspace', pageId: 'page' },
    activeDeck: { id, version: 1, plan, style, sourceRevision: 'revision', createdAt: '', source },
  };
}

beforeEach(() => {
  let id = 0;

  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => `request-${++id}` });
});

test('uncertain export retries retain identity but switching artifact starts a new request', async () => {
  const download = jest.fn().mockRejectedValue(new Error('Connection lost'));
  const view = render(<SlidesWorkflow {...props(download)} />);

  fireEvent.click(screen.getByText('Export PPTX'));
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(screen.getByText('Retry download')).toBeTruthy());
  fireEvent.click(screen.getByText('Retry download'));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  expect(download.mock.calls[0][0]).toBe(download.mock.calls[1][0]);
  view.rerender(<SlidesWorkflow {...props(download, 'deck-two')} />);
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(3));
  expect(download.mock.calls[2][0]).not.toBe(download.mock.calls[0][0]);
});

test('confirmed canceled export releases its request identity for the next attempt', async () => {
  const download = jest.fn().mockImplementation((_id, _signal, onJob) => {
    onJob({ state: 'canceled' });
    return Promise.reject(new Error('Canceled'));
  });

  render(<SlidesWorkflow {...props(download)} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(screen.getByText('Retry download')).toBeTruthy());
  fireEvent.click(screen.getByText('Retry download'));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  expect(download.mock.calls[0][0]).not.toBe(download.mock.calls[1][0]);
});

test('submits an export above the former Free cap and surfaces the actual API entitlement error', async () => {
  const download = jest.fn().mockRejectedValue(new PresentationAPIError('Your current export allowance is exhausted.', 'PPT_EXPORT_LIMIT', 402));
  const input = props(download);
  const original = input.plan!;

  input.plan = { ...original, slides: Array.from({ length: 25 }, (_, index) => ({ ...original.slides[0], id: `slide-${index}` })) };
  render(<SlidesWorkflow {...input} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  expect(screen.queryByText(/one free|at most 12|used your free/i)).toBeNull();
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(screen.getByText('Your current export allowance is exhausted.')).toBeTruthy());
  expect(download).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
  expect(input.onUpgrade).toHaveBeenCalledTimes(1);
});
