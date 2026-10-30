import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import MindMapStylePicker from '../MindMapStylePicker';
import SlideCountDropdown from '../SlideCountDropdown';

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

test('custom choices follow the current server maximum instead of a fixed client range', async () => {
  const onValueChange = jest.fn();
  const view = render(<SlideCountDropdown maxCount={17} disabled={false} onValueChange={onValueChange} />);

  fireEvent.keyDown(screen.getByRole('button', { name: 'Custom' }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(17));
  fireEvent.click(screen.getByRole('menuitemradio', { name: '17', exact: true }));
  expect(onValueChange).toHaveBeenCalledWith(17);
  view.rerender(<SlideCountDropdown maxCount={3} disabled={false} onValueChange={onValueChange} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Custom' }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(3));
  expect(screen.queryByRole('menuitemradio', { name: '17', exact: true })).toBeNull();
});

test('missing maximum does not manufacture a custom-count range or a paid upgrade requirement', () => {
  render(<SlideCountDropdown disabled onValueChange={jest.fn()} />);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Custom' }).disabled).toBe(true);
  expect(screen.queryByText(/upgrade/i)).toBeNull();
});

test('style selections reach the owning action without inferring entitlement from a plan label', () => {
  const onStructure = jest.fn();
  const onBranchLine = jest.fn();

  render(<MindMapStylePicker container={null} structure='right' branchLine='rounded' onStructure={onStructure} onBranchLine={onBranchLine} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mind map styles' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Left-facing tree' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Curved branches' }));
  expect(onStructure).toHaveBeenCalledWith('left');
  expect(onBranchLine).toHaveBeenCalledWith('curved');
  expect(screen.queryByText(/upgrade/i)).toBeNull();
});
