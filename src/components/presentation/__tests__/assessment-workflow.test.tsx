import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { analyzePresentationTemplate, assessPresentation, importPresentationTemplate, reviewPresentationTemplate } from '../presentation-client';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { PresentationStyle, SavedDeck } from '../types';

jest.mock('../presentation-client', () => ({
  assessPresentation: jest.fn(),
  importPresentationTemplate: jest.fn(),
  analyzePresentationTemplate: jest.fn(),
  reviewPresentationTemplate: jest.fn(),
}));
jest.mock('../SlideThemePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../SlideCountDropdown', () => ({
  __esModule: true,
  default: ({ onValueChange }: { onValueChange: (value: number) => void }) => (
    <button onClick={() => onValueChange(6)}>Choose custom 6</button>
  ),
}));
jest.mock('../PresentationSettingsDropdown', () => ({ __esModule: true, default: () => null }));
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
}));

test('failed server assessment disables generation and surfaces retry without a heuristic substitute', async () => {
  jest.useFakeTimers();
  (assessPresentation as jest.Mock).mockRejectedValue(new Error('Analysis unavailable'));
  const options = {
    designMode: 'auto',
    audience: '',
    slideCount: 8,
    slideCountMode: 'auto',
    instructions: '',
    includeProperties: false,
    allowWebSearch: false,
  };
  const style = { id: 'server-theme', name: 'Server theme', font: 'Arial', color: '#000000', background: '#ffffff' };
  const onGenerate = jest.fn();
  const props = {
    snapshot: {
      pageId: 'page',
      revision: 'revision',
      title: 'Row',
      kind: 'row',
      blocks: [],
      properties: [],
      serverSource: {},
    },
    options,
    style,
    styles: [style],
    onOptions: jest.fn(),
    onStyle: jest.fn(),
    onGenerate,
    canGenerate: true,
    remainingSlides: 100,
    maxSlides: 100,
    onStage: jest.fn(),
  } as unknown as SlidesWorkflowProps;

  render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(screen.getByText('Analysis unavailable')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Generate presentation' }).disabled).toBe(true);
  expect(screen.queryByText('Add some document content before generating.')).toBeNull();
  expect(onGenerate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Retry analysis'));
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

function setupProps(overrides: Partial<SlidesWorkflowProps> = {}): SlidesWorkflowProps {
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
      slideCount: 8,
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
    remainingSlides: 19,
    maxSlides: 17,
    onStage: jest.fn(),
    ...overrides,
  } as unknown as SlidesWorkflowProps;
}

test.each([
  { remainingSlides: 19, maxSlides: 7 },
  { remainingSlides: 3, maxSlides: 17 },
])('Auto respects server remaining $remainingSlides and maximum $maxSlides', async ({ remainingSlides, maxSlides }) => {
  jest.useFakeTimers();
  try {
    jest
      .mocked(assessPresentation)
      .mockResolvedValue({ assessment: { recommendedSlideCount: 18, condition: 'clear' } } as never);
    const props = setupProps({ remainingSlides, maxSlides });

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    // The recommendation of 18 exceeds both limits; Auto clamps it during render instead of writing it into options.
    expect(screen.queryByText(/Choose at most|slides remaining/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' }).disabled).toBe(false);
    expect(props.onOptions).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        `${remainingSlides} slides available for this request. Generating and regenerating use this allowance.`
      )
    ).toBeTruthy();
    expect(screen.queryByText(/of 12 free/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('fixed count uses the reported maximum and custom selection retains its own intent', async () => {
  jest.useFakeTimers();
  try {
    jest
      .mocked(assessPresentation)
      .mockResolvedValue({ assessment: { recommendedSlideCount: 5, condition: 'clear' } } as never);
    const base = setupProps();
    const props = {
      ...base,
      maxSlides: 7,
      options: { ...base.options, slideCountMode: 'fixed' as const, slideCountSelection: 'preset' as const },
    };

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByText('Choose at most 7 slides per presentation.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate presentation' }).disabled).toBe(true);
    fireEvent.click(screen.getByText('Choose custom 6'));
    expect(props.onOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ slideCount: 6, slideCountSelection: 'custom' })
    );
    fireEvent.click(screen.getByRole('button', { name: '6', exact: true }));
    expect(props.onOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ slideCount: 6, slideCountSelection: 'preset' })
    );
  } finally {
    jest.useRealTimers();
  }
});

const template: PresentationStyle = {
  id: 'template',
  serverVersion: 1,
  templateName: 'Company template',
  name: 'Company template',
  description: '',
  color: '#123456',
  background: '#ffffff',
  textColor: '#111111',
  font: 'Arial',
  footer: '',
  guidelines: '',
  serverStyle: {
    reference: { id: 'template', version: 1 },
    theme: {
      id: 'company',
      name: 'Company',
      description: '',
      color: '#123456',
      background: '#ffffff',
      textColor: '#111111',
      font: 'Arial',
      bodyFont: 'Arial',
      footer: '',
      palette: [],
      guidelines: '',
    },
    templateSlides: [],
  },
};

test.each(['design', 'workspace', 'unmount'] as const)(
  'discards a pending template upload after a %s change',
  async (change) => {
    jest.useFakeTimers();
    try {
      let finish!: (value: PresentationStyle) => void;

      jest.mocked(importPresentationTemplate).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const base = setupProps();
      const props = { ...base, options: { ...base.options, designMode: 'template' as const } };
      const rendered = render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'first', pageId: 'page' }} />);

      fireEvent.change(screen.getByLabelText('Import presentation template'), {
        target: { files: [new File(['pptx'], 'company.pptx')] },
      });
      const signal = jest.mocked(importPresentationTemplate).mock.calls.at(-1)![2]!;

      if (change === 'design') fireEvent.click(screen.getByRole('button', { name: 'AppFlowy themes' }));
      else if (change === 'workspace')
        rendered.rerender(<SlideGenerationSetup props={props} scope={{ workspaceId: 'second', pageId: 'page' }} />);
      else rendered.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => finish(template));
      expect(screen.queryByText('Company template')).toBeNull();
      expect(props.onStyle).not.toHaveBeenCalledWith(template);
    } finally {
      jest.useRealTimers();
    }
  }
);

test('a late template review cannot replace a newly chosen design', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(importPresentationTemplate).mockResolvedValue(template);
    jest.mocked(analyzePresentationTemplate).mockResolvedValue({ ...template, serverStyle: { ...template.serverStyle!, analysis: { name: 'Brand', description: 'Design', guidelines: 'Guidance' } } });
    let finish!: (value: PresentationStyle) => void;

    jest.mocked(reviewPresentationTemplate).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const base = setupProps();
    const props = { ...base, options: { ...base.options, designMode: 'template' as const } };

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import presentation template'), {
        target: { files: [new File(['pptx'], 'company.pptx')] },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
    const signal = jest.mocked(reviewPresentationTemplate).mock.calls.at(-1)![2]!;

    fireEvent.click(screen.getByRole('button', { name: 'Let AI choose' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...template, serverVersion: 2 }));
    expect(props.onStyle).not.toHaveBeenCalled();
    expect(screen.queryByText('Company template')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('completed assessment survives setup remount and busy transitions, but changed input assesses again', async () => {
  jest.useFakeTimers();
  jest
    .mocked(assessPresentation)
    .mockClear()
    .mockResolvedValue({ assessment: { condition: 'concise', recommendedSlideCount: 4 } } as never);
  const assessmentCache = new Map();
  const props = setupProps({ assessmentCache, canAssess: true, promptBundleVersion: 'bundle-1' });
  const scope = { workspaceId: 'workspace', pageId: 'page' };
  const view = render(<SlideGenerationSetup props={props} scope={scope} />);

  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  view.rerender(<SlideGenerationSetup props={{ ...props, canGenerate: false }} scope={scope} busy />);
  view.rerender(<SlideGenerationSetup props={props} scope={scope} />);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  view.unmount();
  const reopened = render(<SlideGenerationSetup props={props} scope={scope} />);

  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(1);
  reopened.rerender(
    <SlideGenerationSetup props={{ ...props, snapshot: { ...props.snapshot, revision: 'edited' } }} scope={scope} />
  );
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(2);
  reopened.rerender(
    <SlideGenerationSetup props={{ ...props, options: { ...props.options, includeProperties: true } }} scope={scope} />
  );
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

test('a saved deck reuses its analysis across theme and count changes without another request', async () => {
  jest.useFakeTimers();
  jest.mocked(assessPresentation).mockClear();
  const base = setupProps({ canAssess: true, promptBundleVersion: 'bundle-1', assessmentCache: new Map() });
  const activeDeck = {
    sourceRevision: base.snapshot.revision,
    options: base.options,
    style: base.style,
    assessment: { value: { condition: 'concise', recommendedSlideCount: 4 }, promptBundleVersion: 'bundle-1' },
  } as SavedDeck;
  const props = { ...base, activeDeck };
  const scope = { workspaceId: 'workspace', pageId: 'page' };
  const view = render(<SlideGenerationSetup props={props} scope={scope} />);

  for (const count of [4, 6, 8, 12]) {
    view.rerender(
      <SlideGenerationSetup
        props={{
          ...props,
          style: { ...base.style, id: `theme-${count}` },
          options: { ...base.options, slideCount: count, slideCountMode: 'fixed' },
        }}
        scope={scope}
      />
    );
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByText('Analyzing your sources…')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' }).disabled).toBe(false);
  }

  expect(assessPresentation).not.toHaveBeenCalled();
  view.rerender(
    <SlideGenerationSetup
      props={{ ...props, snapshot: { ...props.snapshot, revision: 'database-row-changed' } }}
      scope={scope}
    />
  );
  jest
    .mocked(assessPresentation)
    .mockResolvedValue({ assessment: { condition: 'concise', recommendedSlideCount: 6 } } as never);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('a cosmetic change keeps an in-flight analysis instead of aborting it during the reuse check', async () => {
  jest.useFakeTimers();
  let finish!: (value: unknown) => void;

  jest
    .mocked(assessPresentation)
    .mockClear()
    .mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never
    );
  const props = setupProps({ canAssess: true, assessmentCache: new Map() });
  const scope = { workspaceId: 'workspace', pageId: 'page' };
  const view = render(<SlideGenerationSetup props={props} scope={scope} />);

  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  const signal = jest.mocked(assessPresentation).mock.calls[0][1]!;

  view.rerender(
    <SlideGenerationSetup
      props={{
        ...props,
        style: { ...props.style, id: 'rose' },
        options: { ...props.options, slideCount: 6 },
        reuse: { available: false, checking: true, onOpen: jest.fn(), onRetry: jest.fn() },
      }}
      scope={scope}
    />
  );
  expect(signal.aborted).toBe(false);
  await act(async () => {
    finish({ assessment: { condition: 'concise', recommendedSlideCount: 4 } });
  });
  view.rerender(<SlideGenerationSetup props={props} scope={scope} />);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(assessPresentation).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
