import { render, screen } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';

jest.mock('@/assets/icons/list.svg', () => ({
  ReactComponent: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='list-view-icon' {...props} />,
}));

describe('PageIcon', () => {
  it('renders the List layout icon', () => {
    render(<PageIcon view={{ layout: ViewLayout.List }} />);

    expect(screen.getByTestId('list-view-icon')).toBeTruthy();
  });
});
