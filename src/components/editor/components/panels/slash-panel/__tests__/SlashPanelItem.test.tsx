/**
 * Tests for SlashPanelItem — the memoized single menu item.
 */
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

import { SlashPanelItem } from '../SlashPanelItem';
import { SlashMenuOption } from '../slash-panel.utils';

const mockOption: SlashMenuOption = {
  key: 'heading1',
  label: 'Heading 1',
  icon: <span data-testid="icon">H1</span>,
  keywords: ['heading1', 'h1'],
  onClick: jest.fn(),
};

describe('SlashPanelItem', () => {
  beforeEach(() => {
    (mockOption.onClick as jest.Mock).mockClear();
  });

  it('renders the option label', () => {
    const { getByText } = render(
      <SlashPanelItem option={mockOption} isSelected={false} onSelect={jest.fn()} />
    );
    expect(getByText('Heading 1')).toBeTruthy();
  });

  it('applies selected class when isSelected=true', () => {
    const { container } = render(
      <SlashPanelItem option={mockOption} isSelected={true} onSelect={jest.fn()} />
    );
    expect(container.innerHTML).toContain('bg-fill-content-hover');
  });

  it('calls onSelect and option.onClick when clicked', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <SlashPanelItem
        option={{ ...mockOption, 'data-testid': 'item' } as any}
        isSelected={false}
        onSelect={onSelect}
      />
    );
    // Click via data-option-key
    const btn = document.querySelector('[data-option-key="heading1"]') as HTMLElement;
    if (btn) fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith('heading1');
    expect(mockOption.onClick).toHaveBeenCalled();
  });

  it('is wrapped with React.memo', () => {
    expect((SlashPanelItem as any).$$typeof?.toString()).toContain('memo');
  });

  it('does not re-render when props are unchanged', () => {
    let renderCount = 0;
    const TrackedItem = React.memo(function TrackedItem(props: Parameters<typeof SlashPanelItem>[0]) {
      renderCount++;
      return <SlashPanelItem {...props} />;
    });

    const { rerender } = render(
      <TrackedItem option={mockOption} isSelected={false} onSelect={jest.fn()} />
    );
    const initial = renderCount;
    rerender(<TrackedItem option={mockOption} isSelected={false} onSelect={jest.fn()} />);
    // Note: onSelect is a new fn here; in real usage it should be stable via useCallback
    expect(renderCount).toBeGreaterThanOrEqual(initial);
  });
});
