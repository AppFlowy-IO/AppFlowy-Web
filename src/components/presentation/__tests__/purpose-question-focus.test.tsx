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
jest.mock('../SlideThemePicker', () => ({ __esModule: true, default: () => null }));
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

const question = 'What should this presentation help the audience decide?';
const style: PresentationStyle = {
  id: 'theme',
  name: 'Theme',
  description: '',
  color: '#000000',
  background: '#ffffff',
  font: 'Arial',
  footer: '',
  guidelines: '',
};

/** Owns options like the studio does, so typed values flow back into the setup. */
function Setup({ revision = 'revision' }: { revision?: string }) {
  const [options, setOptions] = React.useState<GenerationOptions>({
    designMode: 'theme',
    audience: '',
    slideCount: 8,
    slideCountMode: 'auto',
    instructions: '',
    includeProperties: false,
    allowWebSearch: false,
  });
  const props = {
    snapshot: { pageId: 'page', revision, title: 'Source', kind: 'document', blocks: [], properties: [], warnings: [], serverSource: {} },
    options,
    onOptions: setOptions,
    style,
    styles: [style],
    onStyle: jest.fn(),
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
  jest
    .mocked(assessPresentation)
    .mockReset()
    .mockResolvedValueOnce({ assessment: { condition: 'ambiguous', question, recommendedSlideCount: 6 } } as never)
    // With a purpose the server no longer asks for one.
    .mockResolvedValue({ assessment: { condition: 'concise', recommendedSlideCount: 6 } } as never);
});
afterEach(() => jest.useRealTimers());

test('the purpose field keeps focus and every character while each answer is reassessed', async () => {
  render(<Setup />);
  await advance(400);
  const input = screen.getByLabelText<HTMLInputElement>('Presentation purpose');
  const purpose = 'Choose a vendor';

  input.focus();
  for (let length = 1; length <= purpose.length; length++) {
    fireEvent.change(input, { target: { value: purpose.slice(0, length) } });
    // One pause is long enough for a reassessment to land mid-answer.
    await advance(length === 6 ? 400 : 100);
    expect(screen.getByLabelText('Presentation purpose')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText(question)).toBeTruthy();
  }

  expect(input.value).toBe(purpose);
  // The previous answer stays until the new one lands; generation waits for it.
  expect(generateButton().disabled).toBe(true);
  await advance(400);
  expect(generateButton().disabled).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(assessPresentation).toHaveBeenCalledTimes(3);
  expect(jest.mocked(assessPresentation).mock.calls[2][0].options.purpose).toBe(purpose);
});

test('a new source revision asks again instead of keeping the previous question', async () => {
  const view = render(<Setup />);

  await advance(400);
  fireEvent.change(screen.getByLabelText('Presentation purpose'), { target: { value: 'Choose a vendor' } });
  await advance(400);
  expect(screen.getByLabelText('Presentation purpose')).toBeTruthy();
  view.rerender(<Setup revision='revision-2' />);
  expect(screen.queryByLabelText('Presentation purpose')).toBeNull();
  await advance(400);
  expect(screen.queryByLabelText('Presentation purpose')).toBeNull();
  expect(generateButton().disabled).toBe(false);
});
