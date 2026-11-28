import { render, screen } from '@testing-library/react';

import FormulaPopover from '../FormulaPopover';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('FormulaPopover', () => {
  it('renders the inline equation input with a monospaced font', () => {
    render(
      <FormulaPopover
        open
        defaultValue='E=mc^2'
        onClose={() => undefined}
        onDone={() => undefined}
        anchorPosition={{ top: 0, left: 0 }}
      />
    );

    expect(screen.getByRole('textbox').className).toContain('font-mono');
  });
});
