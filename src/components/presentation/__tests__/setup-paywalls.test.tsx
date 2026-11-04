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
const prepare = jest.fn();

function Setup({ remaining = 4, custom = false, cached = false, prepareSource = false }: { remaining?: number; custom?: boolean; cached?: boolean; prepareSource?: boolean }) {
  const [options, setOptions] = useState<GenerationOptions>({ designMode: 'auto', slideCountMode: 'fixed', slideCountSelection: custom ? 'custom' : 'preset', slideCount: custom ? 4 : 8,
    audience: '', instructions: 'Keep this instruction', allowWebSearch: false, includeProperties: false });
  const props = {
    snapshot: { pageId: 'page', revision: 'revision', title: 'Source', blocks: [], properties: [], serverSource: {} },
    options, onOptions: setOptions, style: APPFLOWY_SLIDE_THEMES[0], styles: APPFLOWY_SLIDE_THEMES, onStyle: jest.fn(),
    canGenerate: remaining > 0, canAssess: remaining > 0, remainingSlides: remaining, maxSlides: remaining, isPro: false, customSlideCount: false,
    onUpgrade: upgrade, onGenerate: generate,
    onPrepareGeneration: prepareSource ? prepare : undefined,
    reuse: { available: cached, checking: false, onOpen: openCached },
  } as unknown as SlidesWorkflowProps;

  return <><output aria-label='Saved instructions'>{options.instructions}</output><SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} /></>;
}

async function settle() { await act(async () => { await jest.advanceTimersByTimeAsync(500); }); }

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(assessPresentation).mockResolvedValue({ assessment: { condition: 'clear', recommendedSlideCount: 4 } } as never);
  prepare.mockResolvedValue({ pageId: 'page', revision: 'revision', serverSource: {} });
});
afterEach(() => jest.useRealTimers());

test('eight requested with four left offers smaller count and Upgrade without losing settings', async () => {
  render(<Setup />);
  await settle();
  expect(screen.getByText(/4 slides remaining.*Auto or a smaller/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Generate presentation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade workspace' }));
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
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Upgrade workspace' }).disabled).toBe(false);
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test('zero slides does not gate opening a reusable result or spend another generation', async () => {
  render(<Setup remaining={0} cached />);
  await settle();
  expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Upgrade workspace' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open presentation' }));
  await settle();
  expect(openCached).toHaveBeenCalledTimes(1);
  expect(generate).not.toHaveBeenCalled();
  expect(assessPresentation).not.toHaveBeenCalled();
});

test('zero slides makes workspace upgrade the primary action without requesting analysis', async () => {
  render(<Setup remaining={0} prepareSource />);
  await settle();
  expect(screen.getByText('Slide limit reached')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade workspace' }));
  expect(upgrade).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test('an exhausted allowance never asks the user to search for an already-checked saved result', async () => {
  render(<Setup remaining={0} prepareSource />);
  await settle();
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Find saved presentation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade workspace' }));
  expect(upgrade).toHaveBeenCalledTimes(1);
  expect(assessPresentation).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});
