import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import SlidesWorkflow from '../SlidesWorkflow';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { Slide, StoryPlan } from '../types';

const mockLayoutRenders = new Map<string, number>();
const mockLayoutOptions = new Set<unknown>();

jest.mock('../ServerSlideCanvas', () => ({
  __esModule: true,
  default: () => null,
  ServerSlideSceneProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../SlideGenerationSetup', () => ({ __esModule: true, default: () => null }));
jest.mock('../FullscreenControl', () => ({ __esModule: true, default: () => null }));
jest.mock('../presentation-client', () => ({ PresentationAPIError: class extends Error {} }));
// Each card renders one layout dropdown, so its renders count the card's renders.
jest.mock('../PresentationSettingsDropdown', () => ({
  __esModule: true,
  default: ({ ariaLabel, options }: { ariaLabel: string; options: unknown }) => {
    mockLayoutRenders.set(ariaLabel, (mockLayoutRenders.get(ariaLabel) ?? 0) + 1);
    mockLayoutOptions.add(options);
    return null;
  },
}));
jest.mock('@mui/material/Dialog', () => ({ __esModule: true, default: () => null }));
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
  SourceLinks: () => null,
}));

const slide = (id: string, title: string): Slide => ({
  id,
  title,
  message: '',
  points: [],
  layout: 'summary',
  sourceIds: [],
  notes: '',
  warnings: [],
});
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

/** Holds the draft like the studio does; the setter accepts the same updaters. */
function Story() {
  const [plan, setPlan] = React.useState<StoryPlan>({
    title: 'Story',
    slides: [slide('a', 'First'), slide('b', 'Second'), slide('c', 'Third')],
  });
  const props = {
    snapshot: { pageId: 'page', title: 'Page', revision: 'revision', kind: 'document', blocks: [], properties: [], warnings: [] },
    options: { audience: '', slideCount: 3, instructions: '', includeProperties: false, allowWebSearch: false },
    styles: [style],
    style,
    plan,
    onPlan: setPlan,
    stage: 'story',
    canEdit: true,
    hasOutlineChanges: true,
    sourceChanged: false,
  } as unknown as SlidesWorkflowProps;

  return <SlidesWorkflow {...props} />;
}

const titles = () =>
  screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Slide \d title$/ }).map((input) => input.value);

beforeEach(() => {
  mockLayoutRenders.clear();
  mockLayoutOptions.clear();
});

test('editing one story card renders only that card', () => {
  render(<Story />);
  const before = new Map(mockLayoutRenders);

  fireEvent.change(screen.getByRole('textbox', { name: 'Slide 1 title' }), { target: { value: 'Edited' } });
  expect(titles()).toEqual(['Edited', 'Second', 'Third']);
  expect(mockLayoutRenders.get('Slide 1 layout')).toBe(before.get('Slide 1 layout')! + 1);
  expect(mockLayoutRenders.get('Slide 2 layout')).toBe(before.get('Slide 2 layout'));
  expect(mockLayoutRenders.get('Slide 3 layout')).toBe(before.get('Slide 3 layout'));
  // Every card shares one list of layout choices.
  expect(mockLayoutOptions.size).toBe(1);
});

test('moving and removing cards update the latest plan', () => {
  render(<Story />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Slide 1 title' }), { target: { value: 'Edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move slide 1 down' }));
  expect(titles()).toEqual(['Second', 'Edited', 'Third']);
  fireEvent.click(screen.getByRole('button', { name: 'Move slide 3 up' }));
  expect(titles()).toEqual(['Second', 'Third', 'Edited']);
  fireEvent.click(screen.getByRole('button', { name: 'Remove slide 1' }));
  expect(titles()).toEqual(['Third', 'Edited']);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move slide 1 up' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move slide 2 down' }).disabled).toBe(true);
});
