import { fireEvent, render, screen } from '@testing-library/react';

import { WorkspaceGroup } from '@/application/types';

import { GroupSpaceCoverageCard } from '../GroupSpaceCoverageControl';

// Uses the real Radix menu (the other coverage tests flatten it) to check its accessible wiring.
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: { getWorkspaceGroups: jest.fn() } }));
jest.mock('@/application/services/js-services/http/group-space-coverage-api', () => ({
  isGroupSpaceCoverageLevel: (value: unknown) => value === null || value === 10 || value === 30,
  setGroupSpaceCoverage: jest.fn(),
}));

const group: WorkspaceGroup = {
  group_id: '12345678-1234-4123-8123-123456789abc',
  name: 'HR',
  member_count: 3,
  space_coverage_supported: true,
  can_manage_space_coverage: true,
  space_coverage_access_level: 10,
};

beforeAll(() => {
  global.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});

describe('access to all spaces menu', () => {
  it('names the trigger and the open menu with elements that exist', async () => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group} />);
    const trigger = screen.getByRole('button', { name: 'groupSpaceAccess.title groupSpaceAccess.canView' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    const labels = (menu.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);

    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((id) => expect(document.getElementById(id)).not.toBeNull());
    // The menu lists the levels for this setting, so it is named by the setting, not the current level.
    expect(screen.getByRole('menu', { name: 'groupSpaceAccess.title' })).toBe(menu);
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
  });
});
