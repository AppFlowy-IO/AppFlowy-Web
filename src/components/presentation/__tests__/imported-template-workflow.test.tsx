import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { analyzePresentationTemplate, importPresentationTemplate, assessPresentation, reviewPresentationTemplate } from '../presentation-client';
import { reviewedStyleToStyle, themeToStyle } from '../server-adapter';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { Theme } from '../server-contract';
import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { PresentationStyle } from '../types';

jest.mock('../presentation-client', () => ({
  analyzePresentationTemplate: jest.fn(), assessPresentation: jest.fn(), importPresentationTemplate: jest.fn(), reviewPresentationTemplate: jest.fn(),
}));
jest.mock('../PresentationSettingsDropdown', () => ({
  __esModule: true,
  default: ({ label, value, options, onValueChange, disabled }: {
    label: string; value: string; options: { value: string; label: string }[];
    onValueChange: (value: string) => void; disabled: boolean;
  }) => <label>{label}<select aria-label={label} value={value} disabled={disabled}
    onChange={(event) => onValueChange(event.target.value)}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>,
}));
jest.mock('../SlideThemePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../SlideCountDropdown', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));

const theme: Theme = {
  id: 'builtin', name: 'Built-in', description: '', color: '#123456', background: '#ffffff',
  textColor: '#111111', font: 'Arial', bodyFont: 'Arial', footer: '', palette: [], guidelines: '',
};
const saved = reviewedStyleToStyle({
  reference: { id: 'brand', version: 2 }, theme: { ...theme, name: 'Brand template' },
  analysis: { name: 'Brand', description: 'A calm teal theme.', guidelines: 'Use spacious headings.' },
  templateSlides: [{ id: 'slide', title: 'Layout', text: '', textSlots: {}, elements: [] }],
});
const pending = reviewedStyleToStyle({ ...saved.serverStyle!, reference: { id: 'draft', version: 1 } }, true);
const builtin = themeToStyle(theme);
const selected = jest.fn();

function Setup({ initialStyle = builtin, styles = [saved, pending, builtin], maxTemplateBytes }: {
  initialStyle?: PresentationStyle; styles?: PresentationStyle[]; maxTemplateBytes?: number | null;
}) {
  const [style, setStyle] = React.useState(initialStyle);
  const [options, setOptions] = React.useState({
    designMode: 'template' as const, slideCountMode: 'auto' as const, slideCount: 6,
    audience: '', instructions: '', allowWebSearch: false, includeProperties: false,
  });
  const props = {
    snapshot: { pageId: 'page', revision: 'revision', title: 'Source', blocks: [], properties: [], serverSource: {} },
    options, onOptions: setOptions, style, styles,
    onStyle: (next: PresentationStyle) => { selected(next); setStyle(next); },
    canGenerate: true, remainingSlides: 100, maxSlides: 100, maxTemplateBytes, onGenerate: jest.fn(),
  } as unknown as SlidesWorkflowProps;

  return <SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />;
}

const settle = async () => {
  await act(async () => undefined);
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
};

const choose = (id: string) => fireEvent.change(screen.getByLabelText('Saved templates'), { target: { value: id } });
const generate = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(assessPresentation).mockResolvedValue({ assessment: { condition: 'clear', recommendedSlideCount: 6 } } as never);
});
afterEach(() => jest.useRealTimers());

test.each([5, 50])('enforces the %i MB upload allowance before upload or analysis, allowing the exact boundary', async (megabytes) => {
  const limit = megabytes * 1024 * 1024;
  const file = (size: number) => Object.defineProperty(new File(['pptx'], 'brand.pptx'), 'size', { value: size });

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(pending);
  jest.mocked(analyzePresentationTemplate).mockResolvedValueOnce(pending);
  render(<Setup maxTemplateBytes={limit} />);
  expect(screen.getByText(`.pptx or .potx · up to ${megabytes} MB`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [file(limit + 1)] } });
  await settle();
  expect(screen.getByText(megabytes === 5
    ? 'The Free plan allows PowerPoint templates up to 5 MB.'
    : 'Choose a PowerPoint template up to 50 MB.')).toBeTruthy();
  expect(importPresentationTemplate).not.toHaveBeenCalled();
  expect(analyzePresentationTemplate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [file(limit)] } });
  await settle();
  expect(importPresentationTemplate).toHaveBeenCalledTimes(1);
  expect(analyzePresentationTemplate).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('AI theme analysis')).toBeTruthy();
});

test('self-host uploads above 50 MB reach analysis and show no size cap', async () => {
  const file = Object.defineProperty(new File(['pptx'], 'large.pptx'), 'size', { value: 51 * 1024 * 1024 });

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(pending);
  jest.mocked(analyzePresentationTemplate).mockResolvedValueOnce(pending);
  render(<Setup maxTemplateBytes={null} />);
  expect(screen.getByText('.pptx or .potx')).toBeTruthy();
  expect(screen.queryByText(/up to .* MB/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [file] } });
  await settle();
  expect(importPresentationTemplate).toHaveBeenCalledWith(expect.anything(), file, expect.any(AbortSignal));
  expect(analyzePresentationTemplate).toHaveBeenCalledTimes(1);
});

test('selects a saved reviewed template without uploading or reviewing it again', async () => {
  render(<Setup />);
  await settle();
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate().disabled).toBe(true);
  choose(saved.id);
  await settle();
  expect(selected).toHaveBeenLastCalledWith(saved);
  expect(assessPresentation).toHaveBeenCalledWith(expect.objectContaining({ style: saved }), expect.any(AbortSignal));
  expect(reviewPresentationTemplate).not.toHaveBeenCalled();
  expect(generate().disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove template' }));
  await settle();
  expect(selected).toHaveBeenLastCalledWith(builtin);
  expect(screen.getByLabelText('Import presentation template')).toBeTruthy();
  expect(generate().disabled).toBe(true);
});

test('requires review for a saved unfinished upload and keeps it recoverable after a failed save', async () => {
  render(<Setup />);
  choose(pending.id);
  await settle();
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate().disabled).toBe(true);
  jest.mocked(reviewPresentationTemplate).mockRejectedValueOnce(new Error('Save unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  await settle();
  expect(screen.getByText('Save unavailable')).toBeTruthy();
  expect(selected).not.toHaveBeenCalled();
  const approved = { ...pending, requiresReview: false, reviewed: true, serverVersion: 2,
    serverStyle: { ...pending.serverStyle!, reference: { id: pending.id, version: 2 } } };

  jest.mocked(reviewPresentationTemplate).mockResolvedValueOnce(approved);
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  await settle();
  expect(selected).toHaveBeenLastCalledWith(approved);
  expect(generate().disabled).toBe(false);
});

test('restored unreviewed selections cannot generate and can still be reviewed', async () => {
  render(<Setup initialStyle={pending} />);
  await settle();
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate().disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Use this template' })).toBeTruthy();
});

test('switching from a saved template to a built-in design clears its reference', async () => {
  render(<Setup initialStyle={saved} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'AppFlowy themes' }));
  await settle();
  expect(selected).toHaveBeenLastCalledWith(builtin);
  expect(assessPresentation).toHaveBeenLastCalledWith(expect.objectContaining({ style: builtin }), expect.any(AbortSignal));
});

test('older reviewed templates can still be edited without requiring a new AI analysis', async () => {
  const legacy = { ...saved, serverStyle: { ...saved.serverStyle!, analysis: undefined } };

  render(<Setup initialStyle={legacy} styles={[legacy, builtin]} />);
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Updated legacy brand' } });
  await settle();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use this template' }).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Analyze theme with AI' })).toBeNull();
  expect(analyzePresentationTemplate).not.toHaveBeenCalled();
});


test('upload analyzes the theme, shows its result and requires review before selection', async () => {
  const raw = { ...pending, serverStyle: { ...pending.serverStyle!, analysis: undefined } };
  let finish!: (value: PresentationStyle) => void;

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(raw);
  jest.mocked(analyzePresentationTemplate).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<Setup />);
  fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [new File(['pptx'], 'brand.pptx')] } });
  await settle();
  expect(screen.getByRole('status').textContent).toContain('Analyzing template theme with AI');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use this template' }).disabled).toBe(true);
  expect(selected).not.toHaveBeenCalled();
  await act(async () => finish(pending));
  expect(screen.getByLabelText('AI theme analysis').textContent).toContain('A calm teal theme.');
  expect(analyzePresentationTemplate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace' }), raw, expect.any(AbortSignal));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use this template' }).disabled).toBe(false);
  expect(generate().disabled).toBe(true);
});

test('analysis failure retains the upload for retry, and a late result cannot replace another design', async () => {
  const raw = { ...pending, serverStyle: { ...pending.serverStyle!, analysis: undefined } };

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(raw);
  jest.mocked(analyzePresentationTemplate).mockRejectedValueOnce(new Error('Analysis unavailable'));
  render(<Setup />);
  fireEvent.change(screen.getByLabelText('Import presentation template'), { target: { files: [new File(['pptx'], 'brand.pptx')] } });
  await settle();
  expect(screen.getByText('Analysis unavailable')).toBeTruthy();
  expect(screen.getByLabelText('Template name')).toBeTruthy();
  let finish!: (value: PresentationStyle) => void;

  jest.mocked(analyzePresentationTemplate).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Analyze theme with AI' }));
  await settle();
  const signal = jest.mocked(analyzePresentationTemplate).mock.calls.at(-1)![2]!;

  fireEvent.click(screen.getByRole('button', { name: 'Let AI choose' }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(pending));
  expect(screen.queryByLabelText('AI theme analysis')).toBeNull();
  expect(importPresentationTemplate).toHaveBeenCalledTimes(1);
  expect(selected).not.toHaveBeenCalledWith(pending);
});
