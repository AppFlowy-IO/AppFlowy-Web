import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { assessPresentation } from '../presentation-client';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { GenerationOptions, PresentationStyle } from '../types';

jest.mock('../presentation-client', () => ({
  assessPresentation: jest.fn(),
  importPresentationTemplate: jest.fn(),
  reviewPresentationTemplate: jest.fn(),
}));
jest.mock('../SlideThemePicker', () => ({
  __esModule: true,
  default: ({ themes, onSelect }: { themes: PresentationStyle[]; onSelect: (theme: PresentationStyle) => void }) => (
    <>
      {themes.map((theme) => (
        <button key={theme.id} onClick={() => onSelect(theme)}>
          Use {theme.name}
        </button>
      ))}
    </>
  ),
}));
jest.mock('../SlideCountDropdown', () => ({ __esModule: true, default: () => null }));
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

const theme = (id: string): PresentationStyle => ({
  id,
  name: id,
  description: '',
  color: '#000000',
  background: '#ffffff',
  font: 'Arial',
  footer: '',
  guidelines: '',
});
const current = theme('current');
const recommended = theme('recommended');
const onOptions = jest.fn();
const onStyle = jest.fn();

/** Owns options and style like the studio does, so values written by the setup flow back into it. */
function Setup({ designMode }: { designMode: GenerationOptions['designMode'] }) {
  const [options, setOptions] = React.useState<GenerationOptions>({
    designMode,
    audience: '',
    slideCount: 8,
    slideCountMode: 'auto',
    instructions: '',
    includeProperties: false,
    allowWebSearch: false,
  });
  const [style, setStyle] = React.useState(current);
  const props = {
    snapshot: { pageId: 'page', revision: 'revision', title: 'Source', kind: 'document', blocks: [], properties: [], warnings: [], serverSource: {} },
    options,
    onOptions: (next: GenerationOptions) => {
      onOptions(next);
      setOptions(next);
    },
    style,
    styles: [current, recommended],
    onStyle: (next: PresentationStyle) => {
      onStyle(next);
      setStyle(next);
    },
    onGenerate: jest.fn(),
    canGenerate: true,
    remainingSlides: 20,
    maxSlides: 20,
    onStage: jest.fn(),
  } as unknown as SlidesWorkflowProps;

  return <SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const generateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' });

beforeEach(() => {
  jest.useFakeTimers();
  onOptions.mockReset();
  onStyle.mockReset();
  jest.mocked(assessPresentation).mockReset().mockResolvedValue({
    assessment: { condition: 'concise', recommendedThemeId: recommended.id, recommendedSlideCount: 5 },
  } as never);
});
afterEach(() => jest.useRealTimers());

test('auto design applies the recommended theme without assessing the source again', async () => {
  render(<Setup designMode='auto' />);
  await advance(400);
  expect(onStyle).toHaveBeenCalledWith(recommended);
  await advance(2000);
  expect(assessPresentation).toHaveBeenCalledTimes(1);
  expect(generateButton().disabled).toBe(false);
});

test('switching design mode after a recommendation requests no assessment', async () => {
  render(<Setup designMode='auto' />);
  await advance(400);
  expect(onStyle).toHaveBeenCalledWith(recommended);
  fireEvent.click(screen.getByRole('button', { name: 'AppFlowy themes' }));
  await advance(400);
  // Without a reviewed template the server rejects a template-mode assessment.
  fireEvent.click(screen.getByRole('button', { name: 'Import template' }));
  await advance(400);
  fireEvent.click(screen.getByRole('button', { name: 'Let AI choose' }));
  await advance(400);
  expect(assessPresentation).toHaveBeenCalledTimes(1);
  expect(onStyle).toHaveBeenCalledTimes(1);
  expect(generateButton().disabled).toBe(false);
});

test('a theme chosen outside auto design is still assessed', async () => {
  render(<Setup designMode='theme' />);
  await advance(400);
  expect(onStyle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use recommended' }));
  await advance(400);
  expect(assessPresentation).toHaveBeenCalledTimes(2);
  expect(jest.mocked(assessPresentation).mock.calls[1][0].style).toBe(recommended);
});

test('an assessment writes no derived condition or Auto count back into the options', async () => {
  jest.mocked(assessPresentation).mockResolvedValue({
    assessment: { condition: 'ambiguous', question: 'What is it for?', recommendedSlideCount: 5 },
  } as never);
  render(<Setup designMode='theme' />);
  await advance(400);
  expect(onOptions).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Presentation purpose'), { target: { value: 'Decide' } });
  expect(onOptions).toHaveBeenCalledTimes(1);
  expect(onOptions.mock.calls[0][0]).toMatchObject({ purpose: 'Decide', slideCount: 8, slideCountMode: 'auto' });
  expect(onOptions.mock.calls[0][0]).not.toHaveProperty('documentCondition');
  await advance(400);
  expect(onOptions).toHaveBeenCalledTimes(1);
});
