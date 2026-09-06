import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';

import { FormQuestionPlaceholder } from '../FormQuestionPlaceholder';

describe('FormQuestionPlaceholder', () => {
  it('renders Upgrade as static guidance rather than an inert button', () => {
    render(<FormQuestionPlaceholder fieldType={FieldType.Media} longAnswer={false} />);

    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(screen.getByText('Upgrade').tagName).toBe('SPAN');
  });
});
