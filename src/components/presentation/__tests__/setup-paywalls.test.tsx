import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { assessPresentation } from '../presentation-client';
import { APPFLOWY_SLIDE_THEMES } from '../slide-themes';
import SlideGenerationSetup from '../SlideGenerationSetup';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { GenerationOptions } from '../types';

jest.mock('../presentation-client', () => ({ assessPresentation: jest.fn() }));
jest.mock('../SlideThemePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../SlideCountDropdown', () => ({ __esModule: true, default: () => null }));

const upgrade = jest.fn();
const generate = jest.fn();
const openCached = jest.fn();

function Setup({ remaining = 4, custom = false, cached = false }: { remaining?: number; custom?: boolean; cached?: boolean }) {
  const [options, setOptions] = useState<GenerationOptions>({ designMode: 'auto', slideCountMode: 'fixed', slideCountSelection: custom ? 'custom' : 'preset', slideCount: custom ? 4 : 8,
    audience: '', instructions: 'Keep this instruction', allowWebSearch: false, includeProperties: false });
  const props = {
    snapshot: { pageId: 'page', revision: 'revision', title: 'Source', blocks: [], properties: [], serverSource: {} },
    options, onOptions: setOptions, style: APPFLOWY_SLIDE_THEMES[0], styles: APPFLOWY_SLIDE_THEMES, onStyle: jest.fn(),
    canGenerate: remaining > 0, canAssess: remaining > 0, remainingSlides: remaining, maxSlides: remaining, isPro: false, customSlideCount: false,
    onUpgrade: upgrade, onGenerate: generate,
    reuse: { available: cached, checking: false, onOpen: openCached },
  } as unknown as SlidesWorkflowProps;

  return <><output aria-label='Saved instructions'>{options.instructions}</output><SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} /></>;
}

async function settle() { await act(async () => { await jest.advanceTimersByTimeAsync(500); }); }

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(assessPresentation).mockResolvedValue({ assessment: { condition: 'clear', recommendedSlideCount: 4 } } as never);
});
afterEach(() => jest.useRealTimers());

test('eight requested with four left offers smaller count and Upgrade without losing settings', async () => {
  render(<Setup />);
  await settle();
  expect(screen.getByText(/4 slides remaining.*Auto or a smaller/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
  expect(upgrade).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status', { name: 'Saved instructions' }).textContent).toBe('Keep this instruction');
  fireEvent.click(screen.getByRole('button', { name: '4', exact: true }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Generate presentation' }));
  await settle();
  expect(generate).toHaveBeenCalledTimes(1);
});

test('restored Custom4 on Free is gated before assessment or generation', async () => {
  render(<Setup custom />);
  await settle();
  expect(screen.getByText(/Custom slide counts require Pro/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate presentation' }).disabled).toBe(true);
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test('zero slides does not gate opening a reusable result or spend another generation', async () => {
  render(<Setup remaining={0} cached />);
  await settle();
  expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open presentation' }));
  await settle();
  expect(openCached).toHaveBeenCalledTimes(1);
  expect(generate).not.toHaveBeenCalled();
  expect(assessPresentation).not.toHaveBeenCalled();
});
