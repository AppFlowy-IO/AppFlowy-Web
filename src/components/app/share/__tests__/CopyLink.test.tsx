import { fireEvent, render, screen } from '@testing-library/react';

import { CopyLink } from '@/components/app/share/CopyLink';
import { copyTextToClipboard } from '@/utils/copy';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn() } }));

it('copies an explicit row link and retains the current-page default', () => {
  const url = 'https://app.test/app/workspace/database?v=board&r=row';
  const { rerender } = render(<CopyLink url={url} />);

  fireEvent.click(screen.getByRole('button', { name: 'shareAction.copyLink' }));
  expect(copyTextToClipboard).toHaveBeenLastCalledWith(url);
  rerender(<CopyLink />);
  fireEvent.click(screen.getByRole('button', { name: 'shareAction.copyLink' }));
  expect(copyTextToClipboard).toHaveBeenLastCalledWith(window.location.href);
});
