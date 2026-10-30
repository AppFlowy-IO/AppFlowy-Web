import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
jest.mock('../presentation-client', () => ({
  PresentationAPIError: class extends Error {
    constructor(message: string, _code: string, public status: number) {
      super(message);
    }
  },
}));
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
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

test('keeps speaker notes and export controls without the technical source-version footer', () => {
  render(<SlidesWorkflow {...props(jest.fn())} />);
  expect(screen.getByText('Sources & speaker notes')).toBeTruthy();
  expect(screen.getByText('Export PPTX')).toBeTruthy();
  expect(screen.queryByText(/Source version |Preview and editable PowerPoint use the same slide layouts/)).toBeNull();
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
  const download = jest
    .fn()
    .mockRejectedValue(new PresentationAPIError('Your current export allowance is exhausted.', 'PPT_EXPORT_LIMIT', 402));
  const input = props(download);
  const original = input.plan!;

  input.plan = {
    ...original,
    slides: Array.from({ length: 25 }, (_, index) => ({ ...original.slides[0], id: `slide-${index}` })),
  };
  render(<SlidesWorkflow {...input} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  expect(screen.queryByText(/one free|at most 12|used your free/i)).toBeNull();
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(screen.getByText('Your current export allowance is exhausted.')).toBeTruthy());
  expect(download).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
  expect(input.onUpgrade).toHaveBeenCalledTimes(1);
});

test('export exhaustion offers Upgrade while leaving preview and editing available', async () => {
  const download = jest.fn();
  const input = { ...props(download), isPro: false, remainingSlides: 8, exportAvailable: false, maxExportSlides: 12 };

  render(<SlidesWorkflow {...input} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  expect(screen.getByText(/one lifetime PowerPoint export/)).toBeTruthy();
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
  expect(input.onUpgrade).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Back to preview'));
  expect(screen.getByText('Export PPTX')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit story plan' })).toBeTruthy();
});

test('zero generated slides remaining does not block the first export', async () => {
  const download = jest.fn().mockRejectedValue(new Error('Delivery interrupted'));
  const input = { ...props(download), isPro: false, remainingSlides: 0, canGenerate: false, exportAvailable: true, maxExportSlides: 12 };

  render(<SlidesWorkflow {...input} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
});

test.each([[413, true, true], [413, false, false], [403, true, false], [429, true, false], [503, true, false]])('export HTTP %i upgradeRequired=%s shows Upgrade=%s', async (status, upgradeRequired, expected) => {
  const download = jest.fn().mockRejectedValue(Object.assign(new Error('Download failed'), { status, details: { upgradeRequired } }));
  const input = { ...props(download), onStatusRefresh: jest.fn() };

  render(<SlidesWorkflow {...input} />);
  fireEvent.click(screen.getByText('Export PPTX'));
  fireEvent.click(screen.getByText('Download PowerPoint (.pptx)'));
  await screen.findByText(/Download failed/);
  expect(Boolean(screen.queryByRole('button', { name: 'Upgrade to Pro' }))).toBe(expected);
  expect(input.onStatusRefresh).toHaveBeenCalledTimes(expected ? 1 : 0);
});

function presentDeck() {
  const input = props(jest.fn());
  const plan = {
    ...input.plan!,
    slides: Array.from({ length: 3 }, (_, index) => ({ ...input.plan!.slides[0], id: `slide-${index}` })),
  };

  render(<SlidesWorkflow {...input} plan={plan} initialAction='present' />);
  return screen.getByRole('button', { name: 'Exit presentation' }).closest<HTMLElement>('.ps-presenter')!;
}

test.each(['Exit presentation', 'Previous slide', 'Next slide', 'Enter fullscreen'])(
  'Space keeps native activation on the focused %s button',
  (name) => {
    const presenter = presentDeck();

    fireEvent.keyDown(presenter, { key: 'ArrowRight' });
    expect(presenter.textContent).toContain('2 / 3');
    const button = screen.getAllByRole('button', { name, exact: true }).at(-1)!;
    const event = createEvent.keyDown(button, { key: ' ', code: 'Space', cancelable: true });

    button.focus();
    fireEvent(button, event);
    expect(event.defaultPrevented).toBe(false);
    expect(presenter.textContent).toContain('2 / 3');
  }
);

test('unhandled presentation keys still navigate from the slide surface', () => {
  const presenter = presentDeck();

  fireEvent.keyDown(presenter, { key: ' ' });
  expect(presenter.textContent).toContain('2 / 3');
  fireEvent.keyDown(presenter, { key: 'PageDown' });
  expect(presenter.textContent).toContain('3 / 3');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Exit presentation' }), { key: 'ArrowLeft' });
  expect(presenter.textContent).toContain('2 / 3');
});

test('handled events, modifier shortcuts and another dialog leave the presented slide alone', () => {
  const presenter = presentDeck();
  const handled = createEvent.keyDown(presenter, { key: 'ArrowRight', cancelable: true });

  handled.preventDefault();
  fireEvent(presenter, handled);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing'])
    fireEvent.keyDown(presenter, { key: 'ArrowRight', [modifier]: true });
  const other = render(
    <div role='dialog'>
      <p>Another dialog</p>
    </div>
  );

  fireEvent.keyDown(screen.getByText('Another dialog'), { key: 'PageDown' });
  expect(presenter.textContent).toContain('1 / 3');
  other.unmount();
});
