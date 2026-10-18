import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';

mockResizeObserver();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/icon-picker/IconPicker', () => ({
  __esModule: true,
  default: ({ onEscape }: { onEscape?: () => void }) => (
    <input
      aria-label='Search icons'
      autoFocus
      onKeyUp={(event) => {
        if (event.key === 'Escape') onEscape?.();
      }}
    />
  ),
}));
jest.mock('@/components/_shared/emoji-picker', () => ({ EmojiPicker: () => null }));
jest.mock('@/components/_shared/image-upload', () => ({ UploadImage: () => null }));

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setContainer}>
      {container && (
        <SpaceIconButton
          container={container}
          spaceIcon=''
          spaceIconColor=''
          spaceName='Research'
          onChange={jest.fn()}
          disabled={disabled}
        />
      )}
    </div>
  );
}

describe('space icon button', () => {
  it('opens the icon picker from the keyboard and gives focus back when it closes', async () => {
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: 'space.changeIcon' });

    act(() => trigger.focus());
    fireEvent.click(trigger);
    const search = await screen.findByRole('textbox', { name: 'Search icons' });

    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyUp(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search icons' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('is a disabled button while the name and icon cannot be changed', async () => {
    render(<Harness disabled />);
    const trigger = await screen.findByRole('button', { name: 'space.changeIcon' });

    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
