import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { NumberConditionalColor } from '@/application/database-yjs/chart.type';
import { NumberColorPage } from '@/components/database/chart/settings/pages/NumberColorPage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      typeof options === 'string' ? options : options?.defaultValue ?? key,
  }),
}));

jest.mock('nanoid', () => ({ nanoid: () => 'abcd1234' }));

function Harness({
  initial,
  onConditional,
  onColor,
}: {
  initial: NumberConditionalColor | null;
  onConditional: jest.Mock;
  onColor: jest.Mock;
}) {
  const [conditional, setConditional] = useState(initial);

  return (
    <NumberColorPage
      title='Color'
      numberColor='blue'
      conditional={conditional}
      onNumberColorChange={onColor}
      onConditionalChange={(next) => {
        onConditional(next);
        setConditional(next);
      }}
      onBack={jest.fn()}
    />
  );
}

function setup(initial: NumberConditionalColor | null = null) {
  const onConditional = jest.fn();
  const onColor = jest.fn();

  render(<Harness initial={initial} onConditional={onConditional} onColor={onColor} />);
  return { onConditional, onColor };
}

const RULES: NumberConditionalColor = {
  enabled: true,
  rules: [
    { id: 'ncr:1', operator: 'gt', value: 5, color: 'green' },
    { id: 'ncr:2', operator: 'lt', value: 2, color: 'red' },
  ],
};

describe('NumberColorPage', () => {
  it('lists the ten color chips in Notion order and writes the picked one', () => {
    const { onColor } = setup();

    expect(screen.getAllByRole('radio').map((chip) => chip.getAttribute('data-testid'))).toEqual(
      ['default', 'gray', 'brown', 'yellow', 'orange', 'green', 'blue', 'purple', 'pink', 'red'].map(
        (name) => `chart-number-color-${name}`
      )
    );
    expect(screen.getByTestId('chart-number-color-blue').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('chart-number-color-green'));
    expect(onColor).toHaveBeenCalledWith('green');
  });

  it('seeds one rule when dynamic color turns on, and keeps the rules when it turns off', () => {
    const { onConditional } = setup();

    fireEvent.click(screen.getByTestId('chart-number-dynamic-color'));
    expect(onConditional).toHaveBeenLastCalledWith({
      enabled: true,
      rules: [{ id: 'ncr:abcd1234', operator: 'gt', value: 0, color: 'green' }],
    });
    // The chips give way to the rules.
    expect(screen.queryByTestId('chart-number-color-blue')).toBeNull();
    expect(screen.getByTestId('chart-number-rule-0')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chart-number-dynamic-color'));
    expect(onConditional).toHaveBeenLastCalledWith({
      enabled: false,
      rules: [{ id: 'ncr:abcd1234', operator: 'gt', value: 0, color: 'green' }],
    });
  });

  it('edits a rule through its inline operator and color lists, one open at a time', () => {
    const { onConditional } = setup(RULES);

    fireEvent.click(screen.getByTestId('chart-number-rule-0-operator'));
    expect(screen.getByTestId('chart-number-rule-0-operator-gte')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chart-number-rule-1-color'));
    // Opening the color list closes the operator list.
    expect(screen.queryByTestId('chart-number-rule-0-operator-gte')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-number-rule-1-color-orange'));
    expect(onConditional).toHaveBeenLastCalledWith({
      enabled: true,
      rules: [RULES.rules[0], { ...RULES.rules[1], color: 'orange' }],
    });

    fireEvent.click(screen.getByTestId('chart-number-rule-0-operator'));
    fireEvent.click(screen.getByTestId('chart-number-rule-0-operator-gte'));
    expect(onConditional).toHaveBeenLastCalledWith({
      enabled: true,
      rules: [{ ...RULES.rules[0], operator: 'gte' }, { ...RULES.rules[1], color: 'orange' }],
    });
  });

  it('commits a rule value on Enter and reverts an invalid one', () => {
    const { onConditional } = setup(RULES);
    const input = screen.getByTestId<HTMLInputElement>('chart-number-rule-0-value');

    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConditional).toHaveBeenLastCalledWith({ enabled: true, rules: [{ ...RULES.rules[0], value: 2 }, RULES.rules[1]] });

    onConditional.mockClear();
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    expect(onConditional).not.toHaveBeenCalled();
    expect(input.value).toBe('2');
  });

  it('adds, deletes and reorders rules', () => {
    const { onConditional } = setup(RULES);

    fireEvent.click(screen.getByTestId('chart-number-add-rule'));
    expect(onConditional).toHaveBeenLastCalledWith({
      enabled: true,
      rules: [...RULES.rules, { id: 'ncr:abcd1234', operator: 'gt', value: 0, color: 'green' }],
    });

    fireEvent.click(screen.getByTestId('chart-number-rule-2-delete'));
    expect(onConditional).toHaveBeenLastCalledWith(RULES);

    fireEvent.keyDown(screen.getByTestId('chart-number-rule-0'), { key: 'ArrowDown', altKey: true });
    expect(onConditional).toHaveBeenLastCalledWith({ enabled: true, rules: [RULES.rules[1], RULES.rules[0]] });
    expect(screen.getByTestId('chart-number-rule-0').getAttribute('data-parity-id')).toBe('dash-number-color-rule');
    expect(
      screen.getByTestId('chart-number-rule-0').querySelector('[data-parity-id="dash-number-color-rule__drag-icon"]')
    ).toBeTruthy();
  });

  it('sets the else color, which reads "Same as Color" while absent', () => {
    const { onConditional } = setup(RULES);

    expect(screen.getByTestId('chart-number-else-color').textContent).toContain('Same as Color');
    fireEvent.click(screen.getByTestId('chart-number-else-color'));
    fireEvent.click(screen.getByTestId('chart-number-else-color-orange'));
    expect(onConditional).toHaveBeenLastCalledWith({ ...RULES, elseColor: 'orange' });
    expect(screen.getByTestId('chart-number-else-color').textContent).toContain('Orange');
  });
});
