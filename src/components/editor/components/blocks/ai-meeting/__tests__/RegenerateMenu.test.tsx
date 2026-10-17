import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import translations from '@/@types/translations/en.json';

import { SUMMARY_DETAIL_OPTIONS, SUMMARY_LANGUAGE_OPTIONS, SummaryTemplateSection } from '../ai-meeting.summary-regenerate';
import { RegenerateMenu } from '../RegenerateMenu';

const mockRegenerate = jest.fn();
const mockSelect = jest.fn();
const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
const mockT = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value : options?.defaultValue ?? key;
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));

const sections: SummaryTemplateSection[] = [
  { id: 'default', title: 'AI template', options: [
    { id: 'auto', defaultLabel: 'Auto', icon: '✨', prompt: 'Auto prompt' },
    { id: 'stand_up', defaultLabel: 'Stand-up', icon: '🧍', prompt: 'Stand-up prompt' },
  ] },
  { id: 'commercial', title: 'Commercial', options: [
    { id: 'account_management', defaultLabel: 'Account Management', icon: '💼', prompt: 'Account prompt' },
  ] },
];

function Fixture({ isRegenerating = false, action = 'regenerate' }: { isRegenerating?: boolean; action?: 'generate' | 'regenerate' } = {}) {
  const [open, setOpen] = useState(false);

  return <RegenerateMenu
    action={action}
    isRegenerating={isRegenerating}
    menuOpen={open}
    onMenuOpenChange={setOpen}
    onRegenerate={mockRegenerate}
    onOptionSelect={mockSelect}
    selectedTemplate='auto'
    selectedDetail='balanced'
    selectedLanguage='en'
    templateSections={sections}
    detailOptions={SUMMARY_DETAIL_OPTIONS}
    languageOptions={SUMMARY_LANGUAGE_OPTIONS}
    getOptionLabel={(option) => option.defaultLabel}
  />;
}

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Summary options' });

  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.findByRole('menu', { name: 'Summary options' });
}

beforeAll(() => {
  // Radix measures menu anchors with ResizeObserver; JSDOM has no layout engine.
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class {
    observe() { /* no layout in JSDOM */ }
    unobserve() { /* no layout in JSDOM */ }
    disconnect() { /* no layout in JSDOM */ }
  } });
});
beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);
afterAll(() => {
  if (originalResizeObserver) Object.defineProperty(window, 'ResizeObserver', originalResizeObserver);
  else Reflect.deleteProperty(window, 'ResizeObserver');
});

describe('AI transcript Regenerate split button and menus', () => {
  it('uses the Flutter primary split control for initial generation with working summary options', async () => {
    render(<Fixture action='generate' />);
    const generate = screen.getByRole('button', { name: 'Generate summary' });

    expect(generate.classList.contains('bg-fill-theme-thick')).toBe(true);
    expect(generate.parentElement?.classList.contains('h-10')).toBe(true);
    expect(generate.parentElement?.classList.contains('rounded-full')).toBe(true);
    fireEvent.click(generate);
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Detailed' }));
    expect(mockSelect).toHaveBeenCalledWith({ summary_detail: 'detailed' });
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
  });

  it('regenerates directly from the main button and opens options separately', async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu();
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menuitemradio', { name: /Auto/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Balanced' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('menuitemradio', { name: 'Spanish' })).toBeNull();
  });

  it.each([
    [/Stand-up/, { summary_template: 'stand_up' }],
    ['Detailed', { summary_detail: 'detailed' }],
  ])('applies %s without triggering a separate default regeneration', async (name, update) => {
    render(<Fixture />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name }));
    expect(mockSelect).toHaveBeenCalledWith(update);
    expect(mockRegenerate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('expands More templates without applying an option and resets on reopening', async () => {
    render(<Fixture />);
    await openMenu();
    expect(screen.queryByText('Commercial')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'More templates' }));
    expect(screen.getByText('Commercial')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Account Management/ })).toBeTruthy();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'More templates' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Summary options' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openMenu();
    expect(screen.queryByText('Commercial')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'More templates' })).toBeTruthy();
  });

  it('opens the separate language submenu and applies a language', async () => {
    render(<Fixture />);
    await openMenu();
    const language = screen.getByRole('menuitem', { name: 'Language English' });

    fireEvent.click(language);
    expect(await screen.findByRole('menu', { name: 'Summary language' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Spanish' }));
    expect(mockSelect).toHaveBeenCalledWith({ summary_language: 'es' });
    expect(mockRegenerate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('supports opening the language submenu with the keyboard and returning with ArrowLeft', async () => {
    render(<Fixture />);
    await openMenu();
    const language = screen.getByRole('menuitem', { name: 'Language English' });

    language.focus();
    fireEvent.keyDown(language, { key: 'ArrowRight' });
    const submenu = await screen.findByRole('menu', { name: 'Summary language' });

    fireEvent.keyDown(submenu, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Summary language' })).toBeNull());
    expect(screen.getByRole('menu', { name: 'Summary options' })).toBeTruthy();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('disables both halves and prevents duplicate requests while generating', () => {
    render(<Fixture isRegenerating />);
    const main = screen.getByRole('button', { name: 'Generating' });
    const options = screen.getByRole('button', { name: 'Summary options' });

    expect(main.disabled).toBe(true);
    expect(options.disabled).toBe(true);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(main);
    fireEvent.keyDown(options, { key: 'ArrowDown' });
    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
