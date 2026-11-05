import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ChatSettingsButton } from '@/components/chat/components/chat-input/chat-settings';
import { ImageOptionsButton } from '@/components/chat/components/chat-input/image-options';
import { ResponseFormatProvider } from '@/components/chat/provider/response-format-provider';

const mockTranslate = (key: string) => key;
const mockUpdateChatSettings = jest.fn().mockResolvedValue(undefined);

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('@/components/chat/chat/context', () => ({ useChatContext: () => ({ chatId: 'chat' }) }));
jest.mock('@/components/chat/provider/messages-handler-provider', () => ({
  useMessagesHandlerContext: () => ({
    chatSettings: { metadata: { instructions: 'Keep answers short' } },
    updateChatSettings: mockUpdateChatSettings,
  }),
}));

beforeEach(() => jest.clearAllMocks());

it('focuses the selected image mode and supports arrow navigation and roving focus', async () => {
  render(
    <ResponseFormatProvider>
      <ImageOptionsButton />
    </ResponseFormatProvider>
  );

  const trigger = screen.getByRole('button', { name: 'chat.image.title' });

  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'chat.image.title' });
  const mode = within(dialog).getByRole('radiogroup', { name: 'chat.image.mode' });
  const off = within(mode).getByRole('radio', { name: 'chat.image.modeOff' });

  await waitFor(() => expect(document.activeElement).toBe(off));
  fireEvent.keyDown(off, { key: 'ArrowRight' });
  const image = within(mode).getByRole('radio', { name: 'chat.image.modeImageOnly' });

  await waitFor(() => {
    expect(document.activeElement).toBe(image);
    expect(image.getAttribute('aria-checked')).toBe('true');
  });
  fireEvent.keyUp(image, { key: 'ArrowRight' });
  expect(within(dialog).getByRole('textbox', { name: 'chat.image.promptLabel' })).toBeTruthy();
  expect(within(dialog).getByRole('radiogroup', { name: 'chat.image.size' })).toBeTruthy();

  const quality = within(dialog).getByRole('radiogroup', { name: 'chat.image.quality' });
  const auto = within(quality).getByRole('radio', { name: 'chat.image.qualityAuto' });

  act(() => auto.focus());
  fireEvent.keyDown(auto, { key: 'ArrowLeft' });
  const hd = within(quality).getByRole('radio', { name: 'chat.image.qualityHd' });

  await waitFor(() => {
    expect(document.activeElement).toBe(hd);
    expect(hd.getAttribute('aria-checked')).toBe('true');
  });
  fireEvent.keyUp(hd, { key: 'ArrowLeft' });

  for (const group of within(dialog).getAllByRole('radiogroup')) {
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((radio) => radio.tabIndex === 0).length
    ).toBeLessThanOrEqual(1);
  }

  expect(hd.tabIndex).toBe(0);

  fireEvent.keyDown(hd, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

it('names chat settings and its field, focuses the instructions, and returns focus on Escape', async () => {
  render(<ChatSettingsButton />);
  const trigger = screen.getByRole('button', { name: 'chat.chatSettings.title' });

  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'chat.chatSettings.instructionsLabel' });
  const instructions = within(dialog).getByRole<HTMLTextAreaElement>('textbox', {
    name: 'chat.chatSettings.instructionsLabel',
  });

  expect(instructions.value).toBe('Keep answers short');
  await waitFor(() => expect(document.activeElement).toBe(instructions));
  fireEvent.keyDown(instructions, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  expect(mockUpdateChatSettings).not.toHaveBeenCalled();
});

it('disables all image options when a submission begins while the panel is open', async () => {
  const view = (disabled = false) => (
    <ResponseFormatProvider>
      <ImageOptionsButton disabled={disabled} />
    </ResponseFormatProvider>
  );
  const { rerender } = render(view());

  fireEvent.click(screen.getByRole('button', { name: 'chat.image.title' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'chat.image.modeImageOnly' }));
  rerender(view(true));

  for (const radio of screen.getAllByRole<HTMLButtonElement>('radio')) {
    expect(radio.disabled).toBe(true);
  }

  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'chat.image.turnOff' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'chat.image.promptLabel' }).disabled).toBe(true);
});
