import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { assessPresentation } from '../presentation-client';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';

jest.mock('../presentation-client', () => ({
  assessPresentation: jest.fn(),
  importPresentationTemplate: jest.fn(),
  reviewPresentationTemplate: jest.fn(),
}));
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
