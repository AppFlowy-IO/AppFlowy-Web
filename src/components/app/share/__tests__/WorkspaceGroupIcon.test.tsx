import { render, screen } from '@testing-library/react';

import { WorkspaceGroup } from '@/application/types';
import { InviteInput } from '@/components/app/share/InviteInput';
import { PersonSuggestionItem } from '@/components/app/share/PersonSuggestionItem';
import { WorkspaceGroupIcon } from '@/components/app/share/WorkspaceGroupIcon';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const group: WorkspaceGroup = {
  group_id: 'group-1',
  name: 'Engineering',
  member_count: 4,
};

function getGroupIcon(container: HTMLElement): SVGSVGElement {
  const icon = container.querySelector<SVGSVGElement>("[data-slot='workspace-group-icon']");

  expect(icon).not.toBeNull();
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
  expect(icon?.classList.contains('text-icon-secondary')).toBe(true);

  return icon as SVGSVGElement;
}

describe('page-share workspace group icons', () => {
  it('matches the medium member avatar footprint in settings rows', () => {
    render(<WorkspaceGroupIcon variant='settings-row' />);

    const iconContainer = screen.getByTestId('workspace-group-icon-settings-row');

    expect(iconContainer.classList.contains('h-8')).toBe(true);
    expect(iconContainer.classList.contains('w-8')).toBe(true);
    expect(iconContainer.classList.contains('h-9')).toBe(false);
    expect(iconContainer.classList.contains('w-9')).toBe(false);
  });

  it('uses the canonical row icon in group suggestions', () => {
    const { container } = render(
      <PersonSuggestionItem
        suggestion={{ type: 'group', data: group }}
        isHovered={false}
        onClick={jest.fn()}
        onMouseEnter={jest.fn()}
      />
    );

    const icon = getGroupIcon(container);
    const iconContainer = container.querySelector<HTMLElement>("[data-slot='workspace-group-icon-container']");

    expect(screen.getByText(group.name)).toBeTruthy();
    expect(icon.classList.contains('h-5')).toBe(true);
    expect(icon.classList.contains('w-5')).toBe(true);
    expect(iconContainer?.classList.contains('h-8')).toBe(true);
    expect(iconContainer?.classList.contains('w-8')).toBe(true);
    expect(iconContainer?.classList.contains('rounded-300')).toBe(true);
    expect(iconContainer?.classList.contains('bg-fill-content-hover')).toBe(true);
  });

  it('uses the compact canonical icon in selected group chips', () => {
    const requestAnimationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const { container } = render(
      <InviteInput
        emailTags={[
          {
            id: `group:${group.group_id}`,
            email: group.name,
            name: group.name,
            avatar: '',
            kind: 'group',
            groupId: group.group_id,
            memberCount: group.member_count,
          },
        ]}
        onEmailTagsChange={jest.fn()}
      />
    );

    const icon = getGroupIcon(container);

    expect(screen.getByText(group.name)).toBeTruthy();
    expect(icon.classList.contains('h-4')).toBe(true);
    expect(icon.classList.contains('w-4')).toBe(true);
    expect(container.querySelector("[data-slot='workspace-group-icon-container']")).toBeNull();

    requestAnimationFrameSpy.mockRestore();
  });
});
