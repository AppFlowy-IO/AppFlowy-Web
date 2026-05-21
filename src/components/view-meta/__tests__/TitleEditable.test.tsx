import { fireEvent, render, screen } from '@testing-library/react';

import TitleEditable from '../TitleEditable';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('TitleEditable', () => {
  it('keeps select-all inside the title instead of bubbling to page selection', () => {
    const parentKeyDown = jest.fn();

    render(
      <div onKeyDown={parentKeyDown}>
        <TitleEditable
          viewId='view-id'
          name='Synthetic title'
          onUpdateName={jest.fn()}
          autoFocus={false}
        />
      </div>
    );

    const title = screen.getByTestId('page-title-input');

    fireEvent.keyDown(title, {
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      which: 65,
      ctrlKey: true,
    });

    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe('Synthetic title');
  });
});
