import { render, screen } from '@testing-library/react';

import { AccessLevel } from '@/application/types';
import { GeneralAccess } from '@/components/app/share/GeneralAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'shareAction.generalAccess': 'General access',
        'shareAction.anyoneAt': 'Anyone at ',
        'shareAction.anyoneInThisGroupWithTheLinkCanAccess': 'Anyone in this group with the link can access this page',
        'shareAction.fullAccess': 'Full access',
        'shareAction.canEdit': 'Can edit',
        'shareAction.canViewAndComment': 'Can view and comment',
        'shareAction.canView': 'Can view',
        'shareAction.restricted': 'Restricted',
        'shareAction.restrictedDescription': 'Only people with access can open with the link',
      }[key] ?? key),
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: { name: 'Test Workspace', icon: null },
  }),
}));

describe('GeneralAccess', () => {
  it.each([
    [AccessLevel.FullAccess, 'Full access'],
    [AccessLevel.ReadAndWrite, 'Can edit'],
    [AccessLevel.ReadAndComment, 'Can view and comment'],
    [AccessLevel.ReadOnly, 'Can view'],
  ])('shows the structured policy level %s', (accessLevel, label) => {
    render(<GeneralAccess sectionType={ShareSectionType.Private} accessLevel={accessLevel} />);

    expect(screen.getByText('Anyone at Test Workspace')).toBeTruthy();
    expect(screen.getByText(label, { exact: true })).toBeTruthy();
    expect(screen.queryByText('Restricted')).toBeNull();
  });

  it('shows Restricted for an explicit No access policy', () => {
    render(<GeneralAccess sectionType={ShareSectionType.Public} accessLevel={null} />);

    expect(screen.getByText('Restricted')).toBeTruthy();
    expect(screen.queryByText('Anyone at Test Workspace')).toBeNull();
  });

  it('retains the legacy public fallback when structured policy is unavailable', () => {
    render(<GeneralAccess sectionType={ShareSectionType.Public} />);

    expect(screen.getByText('Full access', { exact: true })).toBeTruthy();
  });
});
