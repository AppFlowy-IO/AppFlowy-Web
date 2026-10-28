import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { assessPresentation, importPresentationTemplate, reviewPresentationTemplate } from '../presentation-client';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { PresentationStyle } from '../types';

jest.mock('../presentation-client', () => ({
  assessPresentation: jest.fn(),
  importPresentationTemplate: jest.fn(),
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
  expect((screen.getByRole('button', { name: 'Generate presentation' })).disabled).toBe(true);
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
    snapshot: { pageId: 'page', revision: 'revision', title: 'Source', kind: 'document', blocks: [], properties: [], serverSource: {} },
    options: { designMode: 'theme', audience: '', slideCount: 8, slideCountMode: 'auto', instructions: '', includeProperties: false, allowWebSearch: false },
    style, styles: [style], onOptions: jest.fn(), onStyle: jest.fn(), onGenerate: jest.fn(), canGenerate: true,
    remainingSlides: 19, maxSlides: 17, onStage: jest.fn(), ...overrides,
  } as unknown as SlidesWorkflowProps;
}

test.each([
  { remainingSlides: 19, maxSlides: 7, expected: 7 },
  { remainingSlides: 3, maxSlides: 17, expected: 3 },
])('Auto respects server remaining $remainingSlides and maximum $maxSlides', async ({ remainingSlides, maxSlides, expected }) => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockResolvedValue({ assessment: { recommendedSlideCount: 18, condition: 'clear' } } as never);
    const props = setupProps({ remainingSlides, maxSlides });

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(props.onOptions).toHaveBeenCalledWith(expect.objectContaining({ slideCount: expected }));
    expect(screen.getByText(`${remainingSlides} slides available for this request. Generating and regenerating use this allowance.`)).toBeTruthy();
    expect(screen.queryByText(/of 12 free/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('fixed count uses the reported maximum and custom selection retains its own intent', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(assessPresentation).mockResolvedValue({ assessment: { recommendedSlideCount: 5, condition: 'clear' } } as never);
    const base = setupProps();
    const props = { ...base, maxSlides: 7, options: { ...base.options, slideCountMode: 'fixed' as const, slideCountSelection: 'preset' as const } };

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(screen.getByText('Choose at most 7 slides per presentation.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Generate presentation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Choose custom 6'));
    expect(props.onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ slideCount: 6, slideCountSelection: 'custom' }));
    fireEvent.click(screen.getByRole('button', { name: '6', exact: true }));
    expect(props.onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ slideCount: 6, slideCountSelection: 'preset' }));
  } finally {
    jest.useRealTimers();
  }
});

const template: PresentationStyle = {
  id: 'template', serverVersion: 1, templateName: 'Company template', name: 'Company template',
  description: '', color: '#123456', background: '#ffffff', textColor: '#111111', font: 'Arial',
  footer: '', guidelines: '',
  serverStyle: {
    reference: { id: 'template', version: 1 },
    theme: { id: 'company', name: 'Company', description: '', color: '#123456', background: '#ffffff',
      textColor: '#111111', font: 'Arial', bodyFont: 'Arial', footer: '', palette: [], guidelines: '' },
    templateSlides: [],
  },
};

test.each(['design', 'workspace', 'unmount'] as const)(
  'discards a pending template upload after a %s change',
  async (change) => {
    jest.useFakeTimers();
    try {
      let finish!: (value: PresentationStyle) => void;
      jest.mocked(importPresentationTemplate).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const base = setupProps();
      const props = { ...base, options: { ...base.options, designMode: 'template' as const } };
      const rendered = render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'first', pageId: 'page' }} />);

      fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [new File(['pptx'], 'company.pptx')] } });
      const signal = jest.mocked(importPresentationTemplate).mock.calls.at(-1)![2]!;

      if (change === 'design') fireEvent.click(screen.getByRole('button', { name: 'AppFlowy themes' }));
      else if (change === 'workspace') rendered.rerender(<SlideGenerationSetup props={props} scope={{ workspaceId: 'second', pageId: 'page' }} />);
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
    let finish!: (value: PresentationStyle) => void;
    jest.mocked(reviewPresentationTemplate).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const base = setupProps();
    const props = { ...base, options: { ...base.options, designMode: 'template' as const } };

    render(<SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [new File(['pptx'], 'company.pptx')] } });
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
