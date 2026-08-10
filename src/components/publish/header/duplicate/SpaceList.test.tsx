import { fireEvent, render, screen } from '@testing-library/react';

import SpaceList from '@/components/publish/header/duplicate/SpaceList';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'publish.addTo': 'Add to',
        'publish.loadSpacesFailed': "Couldn't load spaces.",
        'publish.noSpacesAvailable': 'No spaces available.',
        'button.retry': 'Retry',
      };

      return translations[key] || key;
    },
  }),
}));

describe('SpaceList', () => {
  it('shows a retry action when loading spaces fails', () => {
    const onRetry = jest.fn();

    render(<SpaceList error value={''} spaceList={[]} onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load spaces.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an empty workspace from a loading failure', () => {
    render(<SpaceList value={''} spaceList={[]} />);

    expect(screen.getByText('No spaces available.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
