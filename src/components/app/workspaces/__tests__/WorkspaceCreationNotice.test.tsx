import { render, screen } from '@testing-library/react';

import { WorkspaceCreationCapabilityState } from '@/components/app/hooks/useWorkspaceCreationCapability';

import { WorkspaceCreationNotice } from '../WorkspaceCreationNotice';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const loading = {
  status: 'loading',
  canCreate: false,
  checking: false,
  refresh: jest.fn(),
  isCurrent: () => true,
  scopeKey: 'server:user',
} as unknown as WorkspaceCreationCapabilityState;

test('the loading state announces the check with valid markup', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    render(<WorkspaceCreationNotice capability={loading} />);
    expect(screen.getByRole('status').textContent).toBe('workspaceCreation.loading');
    // The spinner is a block element, which a paragraph cannot contain.
    const nestingWarnings = consoleError.mock.calls.filter(([message]) => String(message).includes('validateDOMNesting'));

    expect(nestingWarnings).toEqual([]);
  } finally {
    consoleError.mockRestore();
  }
});
