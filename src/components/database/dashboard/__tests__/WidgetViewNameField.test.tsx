import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TooltipProvider } from '@/components/ui/tooltip';

import { WIDGET_VIEW_NAME_FIELD_ATTR, WidgetViewNameField } from '../owned-views/WidgetViewNameField';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));

const toastError = (jest.requireMock('sonner') as { toast: { error: jest.Mock } }).toast.error;

beforeEach(() => {
  toastError.mockClear();
});

function renderField(value = 'Board', onCommit = jest.fn()) {
  const view = render(
    <TooltipProvider>
      <WidgetViewNameField onCommit={onCommit} placeholder='Board' value={value} />
    </TooltipProvider>
  );

  return { ...view, onCommit, input: screen.getByTestId<HTMLInputElement>('dashboard-widget-view-name-input') };
}

describe('WidgetViewNameField', () => {
  it('shows the widget title, which is the view name, with the rename hint icon', () => {
    const { input } = renderField('Pipeline');

    expect(input.value).toBe('Pipeline');
    expect(input.getAttribute(WIDGET_VIEW_NAME_FIELD_ATTR)).toBe('true');
    expect(screen.getByTestId('dashboard-widget-view-name-hint')).toBeTruthy();
  });

  it('commits a trimmed new name on Enter', () => {
    const { input, onCommit } = renderField();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  Pipeline board ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Pipeline board');
  });

  it('commits on blur', () => {
    const { input, onCommit } = renderField();

    fireEvent.change(input, { target: { value: 'Pipeline' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith('Pipeline');
  });

  it('reverts on Escape without committing', () => {
    const { input, onCommit } = renderField();

    fireEvent.change(input, { target: { value: 'Typo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    expect(input.value).toBe('Board');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('changes nothing for an empty or unchanged name', () => {
    const { input, onCommit } = renderField();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Board');
    fireEvent.change(input, { target: { value: ' Board ' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps the keys typed here from the menu around it (its type-ahead)', () => {
    const onKeyDown = jest.fn();

    render(
      <TooltipProvider>
        <div onKeyDown={onKeyDown}>
          <WidgetViewNameField onCommit={jest.fn()} placeholder='Board' value='Board' />
        </div>
      </TooltipProvider>
    );
    fireEvent.keyDown(screen.getByTestId('dashboard-widget-view-name-input'), { key: 'p' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('follows a rename made elsewhere while it is not being edited', () => {
    const { rerender, input } = renderField('Board');

    rerender(
      <TooltipProvider>
        <WidgetViewNameField onCommit={jest.fn()} placeholder='Board' value='Renamed elsewhere' />
      </TooltipProvider>
    );
    expect(input.value).toBe('Renamed elsewhere');
  });

  it('puts the current name back and says so when the rename fails', async () => {
    const onCommit = jest.fn().mockRejectedValue(new Error('offline'));
    const { input } = renderField('Board', onCommit);

    fireEvent.change(input, { target: { value: 'Pipeline' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith('Pipeline');
    await waitFor(() => expect(input.value).toBe('Board'));
    expect(toastError).toHaveBeenCalledWith('Could not rename the view');
  });

  it('puts the name the view has by then back when nothing was renamed', async () => {
    let settle: (written: boolean) => void = () => undefined;
    const onCommit = jest.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const { input, rerender } = renderField('Board', onCommit);

    fireEvent.change(input, { target: { value: 'Pipeline' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // A collaborator renamed the view while the refused rename was in flight.
    rerender(
      <TooltipProvider>
        <WidgetViewNameField onCommit={onCommit} placeholder='Board' value='Renamed elsewhere' />
      </TooltipProvider>
    );
    settle(false);

    await waitFor(() => expect(input.value).toBe('Renamed elsewhere'));
    expect(toastError).not.toHaveBeenCalled();
  });
});
