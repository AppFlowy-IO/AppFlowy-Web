import { fireEvent, render, screen } from '@testing-library/react';

import FileDropzone from '../FileDropzone';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function fileInput() {
  return screen.getByTestId('file-dropzone').querySelector('input') as HTMLInputElement;
}

describe('FileDropzone', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers a focusable native browse button and opens the picker once for keyboard activation', () => {
    const onChange = jest.fn();

    render(<FileDropzone placeholder='Browse Confluence ZIP' accept='.zip' onChange={onChange} />);

    const browse = screen.getByRole('button', { name: 'Browse Confluence ZIP' });
    const input = fileInput();
    const click = jest.spyOn(input, 'click');

    expect(browse.tagName).toBe('BUTTON');
    expect(browse.type).toBe('button');
    browse.focus();
    expect(document.activeElement).toBe(browse);
    // Native Enter/Space activation produces a click with no pointer click count.
    fireEvent.click(browse, { detail: 0 });
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['zip'], 'space.html.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file] } });
    expect(onChange).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  it.each(['disabled', 'loading'] as const)('blocks browsing and dropped files while %s', (state) => {
    const onChange = jest.fn();

    render(<FileDropzone placeholder='Browse ZIP' onChange={onChange} {...{ [state]: true }} />);

    const browse = screen.getByRole('button', { name: 'Browse ZIP' });
    const input = fileInput();
    const click = jest.spyOn(input, 'click');
    const file = new File(['zip'], 'space.zip');

    expect(browse.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    fireEvent.click(browse, { detail: 0 });
    fireEvent.drop(screen.getByTestId('file-dropzone'), {
      dataTransfer: { files: [file], clearData: jest.fn() },
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(click).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves ZIP drop selection with multiple=%s', (multiple) => {
    const onChange = jest.fn();
    const files = [new File(['one'], 'one.zip'), new File(['two'], 'two.zip')];
    const clearData = jest.fn();

    render(<FileDropzone placeholder='Browse ZIP' accept='.zip' multiple={multiple} onChange={onChange} />);
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files, clearData } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(multiple ? files : [files[0]]);
    expect(clearData).toHaveBeenCalledTimes(1);
  });
});
