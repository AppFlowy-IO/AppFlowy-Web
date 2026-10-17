import { render } from '@testing-library/react';

import LinearProgressWithLabel from '../LinearProgressWithLabel';

test('renders the percentage in the checklist-progress-label hook the list and timeline card styles recolor', () => {
  const { container } = render(<LinearProgressWithLabel count={4} selectedCount={2} value={0.5} />);

  expect(container.querySelector('.checklist-progress-label')?.textContent).toBe('50%');
});
