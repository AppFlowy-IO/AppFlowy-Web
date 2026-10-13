import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { AIMeetingErrorBanner, AIMeetingImportActions, AIMeetingImportProgress, AIMeetingPromotionBanner, AIMeetingTranscriptLanguage, AIMeetingUpgradeBanner, AIMeetingUrlDialog, AIMeetingWelcome } from '../AIMeetingImport';
import { AIMeetingImportState } from '../useAIMeetingImport';
import { AudioTranscriptionError, TRANSCRIPTION_FILE_ACCEPT } from '@/application/integrations/transcription-media';
import translations from '@/@types/translations/en.json';

const mockT = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_match, name) => String(options?.[name] ?? '')) : options?.defaultValue ?? key;
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));

function state(overrides: Partial<AIMeetingImportState> = {}): AIMeetingImportState {
  return {
    workspaceId: 'workspace', reportError: jest.fn(), available: true, busy: false, stage: 'idle', progress: undefined, error: undefined, errorCode: undefined,
    message: '', usage: undefined, quotaExceeded: false, errorDismissed: false, showPromotion: false, dismissPromotion: jest.fn(),
    dismissError: jest.fn(), canRetry: false, retry: jest.fn(async () => undefined), importSource: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined), language: 'auto', setLanguage: jest.fn(), ...overrides,
  };
}

afterEach(cleanup);

describe('Flutter welcome actions and Figma banners', () => {
  it('renders exactly Transcribe audio file and Paste YouTube URL, hiding the meeting-note action', () => {
    const onUpload = jest.fn();
    const onPasteUrl = jest.fn();

    render(<AIMeetingWelcome disabled={false} onUpload={onUpload} onPasteUrl={onPasteUrl} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Transcribe audio file', 'Paste YouTube URL']);
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe audio file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste YouTube URL' }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onPasteUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/New AI meeting notes/)).toBeNull();
  });

  it('disables all welcome actions when the page is locked or usage is blocked', () => {
    const onUpload = jest.fn();
    const onPasteUrl = jest.fn();

    render(<AIMeetingWelcome disabled onUpload={onUpload} onPasteUrl={onPasteUrl} />);
    screen.getAllByRole('button').forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe audio file' }));
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('provides Retry and dismiss controls for an upload or network error', () => {
    const retry = jest.fn();
    const dismiss = jest.fn();

    render(<AIMeetingErrorBanner message='Unable to upload the audio file.' onRetry={retry} onDismiss={dismiss} />);
    expect(screen.getByRole('alert').textContent).toContain('Click to Retry');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss transcription error' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('does not display a retry action when the source cannot be retried', () => {
    render(<AIMeetingErrorBanner message='Select another file.' />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers a dismissible Pro upgrade with the Figma promotion copy', () => {
    const onUpgrade = jest.fn();
    const onDismiss = jest.fn();

    render(<AIMeetingPromotionBanner onUpgrade={onUpgrade} onDismiss={onDismiss} />);
    expect(screen.getByText('for more meeting and audio minutes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss upgrade promotion' }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the existing plan-comparison flow and preserves other navigation parameters', () => {
    const Location = () => <output>{useLocation().search}</output>;

    render(<MemoryRouter initialEntries={['/app/workspace?view=meeting']}><AIMeetingUpgradeBanner onDismiss={jest.fn()} /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(screen.getByRole('status').textContent).toBe('?view=meeting&action=change_plan');
  });

  it('reports real upload progress and uses an indeterminate processing status', () => {
    const { rerender } = render(<AIMeetingImportProgress stage='uploading' progress={0.25} />);

    expect(screen.getByRole('status').textContent).toBe('Uploading (25%)...');
    rerender(<AIMeetingImportProgress stage='analyzing' />);
    expect(screen.getByRole('status').textContent).toBe('Processing your file');
  });

  it('cycles Flutter processing messages every eight seconds, with dots every second, and clears its timer', () => {
    jest.useFakeTimers();
    const { rerender, unmount } = render(<AIMeetingImportProgress stage='analyzing' />);

    expect(screen.getByRole('status').textContent).toBe('Processing your file');
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.getByRole('status').textContent).toBe('Processing your file...');
    act(() => { jest.advanceTimersByTime(5000); });
    expect(screen.getByRole('status').textContent).toBe('Analyzing content');
    act(() => { jest.advanceTimersByTime(40000); });
    expect(screen.getByRole('status').textContent).toBe('Processing your file');
    rerender(<AIMeetingImportProgress stage='summarizing' />);
    expect(screen.getByRole('status').textContent).toBe('Generating AI summary');
    act(() => { jest.advanceTimersByTime(16000); });
    expect(screen.getByRole('status').textContent).toBe('Distilling the information');
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('displays the Flutter language code with accessible full language names', () => {
    const onChange = jest.fn();

    render(<AIMeetingTranscriptLanguage value='en' disabled={false} onChange={onChange} />);
    expect(screen.getByText('EN')).toBeTruthy();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Auto', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Transcript language' }), { target: { value: 'fr' } });
    expect(onChange).toHaveBeenCalledWith('fr');
  });

  it('keeps unsupported saved language codes readable without selecting a different language', () => {
    render(<AIMeetingTranscriptLanguage value='zh' disabled onChange={jest.fn()} />);
    const select = screen.getByRole('combobox');

    expect(select.value).toBe('zh');
    expect(select.disabled).toBe(true);
    expect(screen.getAllByText('AUTO')).toHaveLength(2);
  });
});

describe('Paste YouTube URL dialog', () => {
  it('keeps Transcribe disabled for empty, invalid and unsupported URLs', () => {
    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={jest.fn()} onConfirm={jest.fn()} />);
    const input = screen.getByRole('textbox');
    const confirm = screen.getByRole('button', { name: 'Transcribe' });

    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'https://example.com/page' } });
    fireEvent.blur(input);
    expect(confirm.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain("This link isn't supported");
  });

  it('accepts a signed direct URL and submits it with Enter', () => {
    const onConfirm = jest.fn();

    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={jest.fn()} onConfirm={onConfirm} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'https://example.com/meeting.mp4?token=signed' } });
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledWith({ url: 'https://example.com/meeting.mp4?token=signed' });
  });

  it('cancels without importing', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('prefills a valid clipboard link', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: jest.fn().mockResolvedValue('https://example.com/meeting.wav') } });
    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={jest.fn()} onConfirm={jest.fn()} />);
    await waitFor(() => expect((screen.getByRole('textbox')).value).toBe('https://example.com/meeting.wav'));
  });

  it('does not overwrite typed input when a clipboard request finishes late', async () => {
    let complete!: (url: string) => void;

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: jest.fn(() => new Promise<string>((resolve) => { complete = resolve; })) } });
    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={jest.fn()} onConfirm={jest.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/my-recording.mp3' } });
    complete('https://example.com/clipboard.mp3');
    await Promise.resolve();
    expect((screen.getByRole('textbox')).value).toBe('https://example.com/my-recording.mp3');
  });

  it('handles denied clipboard access without an error', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: jest.fn().mockRejectedValue(new Error('Denied')) } });
    render(<AIMeetingUrlDialog workspaceId="workspace" onClose={jest.fn()} onConfirm={jest.fn()} />);
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('file import controls', () => {
  it('uses Flutter’s supported file types and allows selecting the same file again', () => {
    const importer = state();
    const { container } = render(<AIMeetingImportActions state={importer} showWelcome />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['recording'], 'meeting.mp4');

    expect(input.accept).toBe(TRANSCRIPTION_FILE_ACCEPT);
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(importer.importSource).toHaveBeenCalledTimes(2);
    expect(input.value).toBe('');
  });

  it.each([{ available: false }, { quotaExceeded: true }, { busy: true }])('blocks import for %j', (overrides) => {
    const importer = state(overrides);
    const { container } = render(<AIMeetingImportActions state={importer} showWelcome />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { files: [new File(['a'], 'meeting.mp4')] } });
    expect(importer.importSource).not.toHaveBeenCalled();
  });

  it('shows the Figma size-limit dialog with the server’s actual limit and Re-upload action', () => {
    const importer = state({ error: new AudioTranscriptionError('fileTooLarge', undefined, 25 * 1024 * 1024), errorCode: 'fileTooLarge' });

    render(<AIMeetingImportActions state={importer} showWelcome />);
    expect(screen.getByRole('dialog').textContent).toContain('This file exceeds the 25 MB limit. Please upload a smaller file.');
    fireEvent.click(screen.getByRole('button', { name: 'Re-upload' }));
    expect(importer.dismissError).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
