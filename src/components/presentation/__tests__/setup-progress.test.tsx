import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { assessPresentation } from '../presentation-client';
import { findReusableResult } from '../server-client';
import SlideGenerationSetup from '../SlideGenerationSetup';
import { useReusableGeneration } from '../useReusableGeneration';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';

jest.mock('../presentation-client', () => ({
  assessPresentation: jest.fn(),
  importPresentationTemplate: jest.fn(),
  reviewPresentationTemplate: jest.fn(),
}));
jest.mock('../server-client', () => ({ findReusableResult: jest.fn() }));
jest.mock('../SlideThemePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../SlideCountDropdown', () => ({ __esModule: true, default: () => null }));
jest.mock('../PresentationSettingsDropdown', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('../ui', () => ({
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const clear = { assessment: { recommendedSlideCount: 6, condition: 'clear' } } as never;

function setupProps(): SlidesWorkflowProps {
  const style = { id: 'server-theme', name: 'Server theme', font: 'Arial', color: '#000000', background: '#ffffff' };

  return {
    snapshot: {
      pageId: 'page',
      revision: 'revision',
      title: 'Source',
      kind: 'document',
      blocks: [],
      properties: [],
      serverSource: {},
    },
    options: {
      designMode: 'theme',
      audience: '',
      slideCount: 6,
      slideCountMode: 'auto',
      instructions: '',
      includeProperties: false,
      allowWebSearch: false,
    },
    style,
    styles: [style],
    onOptions: jest.fn(),
    onStyle: jest.fn(),
    onGenerate: jest.fn(),
    canGenerate: true,
    remainingSlides: 100,
    maxSlides: 100,
    onStage: jest.fn(),
  } as unknown as SlidesWorkflowProps;
}

const generateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' });

test('web search requires an explicit toggle and preserves the other generation settings', () => {
  const props = setupProps();
  const view = render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
  const toggle = screen.getByRole('switch', { name: 'Allow web search' });

  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText('Search the web using page titles and headings. External sources include links.')).toBeTruthy();
  fireEvent.click(toggle);
  expect(props.onOptions).toHaveBeenLastCalledWith({ ...props.options, allowWebSearch: true });
  view.rerender(<SlideGenerationSetup props={{ ...props, options: { ...props.options, allowWebSearch: true } }} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
  fireEvent.click(toggle);
  expect(props.onOptions).toHaveBeenLastCalledWith({ ...props.options, allowWebSearch: false });
});

test('web search assessments stay separate, ignore late opted-in replies and reuse each prepared source', async () => {
  jest.useFakeTimers();
  try {
    const props = setupProps();
    const cache: NonNullable<SlidesWorkflowProps['assessmentCache']> = new Map();
    let finishResearch!: (value: never) => void;
    const assess = jest.mocked(assessPresentation).mockReset().mockResolvedValue(clear);

    const ToggleSetup = () => {
      const [options, setOptions] = React.useState(props.options);

      return <SlideGenerationSetup scope={{ workspaceId: 'workspace', pageId: 'page' }} props={{
        ...props, options, onOptions: setOptions, assessmentCache: cache,
        snapshot: { ...props.snapshot, revision: options.allowWebSearch ? 'researched' : 'native' },
      }} />;
    };

    render(<ToggleSetup />);
    const settle = () => act(async () => { jest.advanceTimersByTime(400); });
    const toggle = () => fireEvent.click(screen.getByRole('switch', { name: 'Allow web search' }));

    await settle();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0][0]).toMatchObject({ options: { allowWebSearch: false }, source: { revision: 'native' } });
    expect(generateButton().disabled).toBe(false);

    assess.mockReturnValueOnce(new Promise((resolve) => { finishResearch = resolve; }));
    toggle();
    await settle();
    expect(assess.mock.calls[1][0]).toMatchObject({ options: { allowWebSearch: true }, source: { revision: 'researched' } });
    expect(generateButton().disabled).toBe(true);
    toggle();
    await settle();
    expect(generateButton().disabled).toBe(false);
    expect(assess).toHaveBeenCalledTimes(2);

    await act(async () => finishResearch({ assessment: { condition: 'ambiguous', question: 'Obsolete web question' } } as never));
    expect(screen.queryByText('Obsolete web question')).toBeNull();
    expect(cache.size).toBe(1);
    toggle();
    await settle();
    expect(assess).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '4', exact: true }));
    await settle();
    toggle();
    await settle();
    toggle();
    await settle();
    expect(assess).toHaveBeenCalledTimes(3);
    expect(generateButton().disabled).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test('above the disabled Generate button, the footer says the sources are being analyzed', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (value: never) => void;

    jest.mocked(assessPresentation).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SlideGenerationSetup props={setupProps()} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);

    const progress = screen.getByText('Analyzing your sources…');

    expect(progress.getAttribute('role')).toBe('status');
    expect(progress.closest('footer')).not.toBeNull();
    expect(generateButton().disabled).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await act(async () => finish(clear));
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
    expect(generateButton().disabled).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test('while generating, the footer says the presentation is being generated', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockResolvedValue(clear);
    render(<SlideGenerationSetup props={setupProps()} scope={{ workspaceId: 'workspace', pageId: 'page' }} busy />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByText('Generating your presentation…').closest('footer')).not.toBeNull();
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});


test('saved results open without assessment or generation, even with no remaining allowance', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockClear();
    const props = setupProps();

    props.canGenerate = false;
    props.remainingSlides = 0;
    props.reuse = { available: true, checking: false, onOpen: jest.fn(), onRetry: jest.fn() };
    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open presentation' });

    expect(open.disabled).toBe(false);
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
    expect(assessPresentation).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(props.reuse.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('settings changes return to Generate and wait for the saved-result check before assessment', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockClear().mockResolvedValue(clear);
    const props = setupProps();
    const reuse = { available: true, checking: false, onOpen: jest.fn(), onRetry: jest.fn() };
    const scope = { workspaceId: 'workspace', pageId: 'page' };
    const view = render(<SlideGenerationSetup props={{ ...props, reuse }} scope={scope} />);

    view.rerender(<SlideGenerationSetup props={{ ...props, options: { ...props.options, tone: 'professional' }, reuse: { ...reuse, available: false, checking: true } }} scope={scope} />);
    expect(generateButton().disabled).toBe(true);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(assessPresentation).not.toHaveBeenCalled();
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
    view.rerender(<SlideGenerationSetup props={{ ...props, reuse: { ...reuse, available: false } }} scope={scope} />);
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(assessPresentation).toHaveBeenCalledTimes(1);
    expect(generateButton().disabled).toBe(false);
  } finally { jest.useRealTimers(); }
});

test.each([false, true])('count changes keep the ready button enabled while checking saved results (saved deck: %s)', async (savedDeck) => {
  jest.useFakeTimers();
  try {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'request-id' });
    jest.mocked(assessPresentation).mockClear().mockResolvedValue(clear);
    jest.mocked(findReusableResult).mockReset().mockResolvedValue(null);
    const base = setupProps();
    const scope = { workspaceId: 'workspace', pageId: 'page' };
    const source = {
      ...base.snapshot,
      serverSource: { ...base.snapshot.serverSource!, sources: [{ pageId: 'page', revision: 'native' }] },
    };

    const Setup = () => {
      const [options, onOptions] = React.useState(base.options);
      const reuse = useReusableGeneration({ scope, task: 'slides', source, options, style: base.style }, true, 'actor');

      return <SlideGenerationSetup scope={scope} props={{
        ...base, snapshot: source, options, onOptions,
        plan: savedDeck ? { title: 'Saved deck', slides: [] } : undefined,
        reuse: { available: !!reuse.job, checking: reuse.checking, error: reuse.error, onOpen: jest.fn(), onRetry: reuse.refresh },
      }} />;
    };

    render(<Setup />);
    await act(async () => { await jest.advanceTimersByTimeAsync(200); });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: savedDeck ? 'Regenerate presentation' : 'Generate presentation',
    });

    expect(button.disabled).toBe(false);
    let finish!: (value: null) => void;

    jest.mocked(findReusableResult).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '4', exact: true }));
    expect(button.disabled).toBe(false);
    await act(async () => { await jest.advanceTimersByTimeAsync(200); });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(base.onGenerate).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '8', exact: true }));
    expect(button.disabled).toBe(false);
    await act(async () => { await jest.advanceTimersByTimeAsync(200); });
    await act(async () => { finish(null); });
    expect(button.disabled).toBe(false);
    expect(assessPresentation).toHaveBeenCalledTimes(1);
    expect(base.onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
    fireEvent.click(button);
    expect(base.onGenerate).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test.each(['match', 'miss', 'error'] as const)('clicking during a lookup waits for its %s before taking action', async (outcome) => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockResolvedValue(clear);
    const base = setupProps();
    const scope = { workspaceId: 'workspace', pageId: 'page' };
    const reuse = { available: false, checking: false, onOpen: jest.fn(), onRetry: jest.fn() };
    const view = render(<SlideGenerationSetup scope={scope} props={{ ...base, reuse }} />);

    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    const selected = { ...base, options: { ...base.options, slideCountMode: 'fixed' as const, slideCount: 4 } };

    view.rerender(<SlideGenerationSetup scope={scope} props={{ ...selected, reuse: { ...reuse, checking: true } }} />);
    expect(generateButton().disabled).toBe(false);
    fireEvent.click(generateButton());
    expect(base.onGenerate).not.toHaveBeenCalled();
    expect(reuse.onOpen).not.toHaveBeenCalled();
    view.rerender(<SlideGenerationSetup scope={scope} props={{
      ...selected, reuse: { ...reuse, available: outcome === 'match', error: outcome === 'error' ? 'Lookup failed' : undefined },
    }} />);
    expect(reuse.onOpen).toHaveBeenCalledTimes(outcome === 'match' ? 1 : 0);
    expect(base.onGenerate).toHaveBeenCalledTimes(outcome === 'miss' ? 1 : 0);
  } finally { jest.useRealTimers(); }
});
