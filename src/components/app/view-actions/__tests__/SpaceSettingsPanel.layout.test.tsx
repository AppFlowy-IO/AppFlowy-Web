import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';

import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';
import SpaceSettingsPanel, { SpaceSettingsTab } from '@/components/app/view-actions/SpaceSettingsPanel';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/** jsdom has no layout: scroll areas report these sizes so the fade can be checked. */
const metrics = { scrollHeight: 900, clientHeight: 600 };
const resizeCallbacks: Array<() => void> = [];
const originals = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  ResizeObserver: global.ResizeObserver,
};

function measured(key: keyof typeof metrics) {
  return {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('overflow-y-auto') ? metrics[key] : 0;
    },
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', measured('scrollHeight'));
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', measured('clientHeight'));
  global.ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }

    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  } as unknown as typeof ResizeObserver;
});

afterAll(() => {
  if (originals.scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originals.scrollHeight);
  if (originals.clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originals.clientHeight);
  global.ResizeObserver = originals.ResizeObserver;
});

beforeEach(() => {
  metrics.scrollHeight = 900;
  metrics.clientHeight = 600;
  resizeCallbacks.length = 0;
});

const permission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Custom,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: null,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: { disable_guests: false, disable_public_links: false, disable_export: false },
};

function Panel({
  tab = 'general',
  visibility = SpaceVisibility.Custom,
  showActions = false,
}: {
  tab?: SpaceSettingsTab;
  visibility?: SpaceVisibility;
  showActions?: boolean;
}) {
  return (
    <SpaceSettingsPanel
      open
      onClose={jest.fn()}
      title='Create space'
      modalTestId='space-settings-modal'
      activeTab={tab}
      onTabChange={jest.fn()}
      membersTabVisible
      membersContent={<div data-testid='members-list'>Members</div>}
      spaceName='Research'
      spaceIcon=''
      spaceIconColor=''
      onSpaceNameChange={jest.fn()}
      onSpaceIconChange={jest.fn()}
      permissionSettings={{ ...permission, visibility }}
      visibilityOptions={[SpaceVisibility.Public, SpaceVisibility.Custom, SpaceVisibility.Private]}
      workspaceName='Acme'
      onVisibilitySelect={jest.fn()}
      onMembersAccessChange={jest.fn()}
      onEveryoneElseAccessChange={jest.fn()}
      onSidebarEditPolicyChange={jest.fn()}
      showActions={showActions}
      primaryActionText='Create'
      onPrimaryAction={jest.fn()}
    />
  );
}

function classes(element: Element | null | undefined) {
  return (element?.className ?? '').split(/\s+/);
}

function generalScrollArea() {
  return screen.getByTestId('space-name-input').closest('.overflow-y-auto') as HTMLElement;
}

describe('space settings dialog layout', () => {
  it('lets the tabs use the height the window leaves instead of a fixed share of it', () => {
    render(<Panel />);
    const scrollArea = generalScrollArea();

    expect(classes(scrollArea)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']));
    expect(scrollArea.className).not.toContain('max-h-[64vh]');
    // The tabs shrink with the dialog, which is limited by the window height.
    expect(classes(screen.getByTestId('space-settings-panel'))).toEqual(
      expect.arrayContaining(['min-h-0', 'flex-1'])
    );
    // The dialog starts a little below the top of the window; a percentage of its width pushed it
    // down on wide windows and below the bottom edge on short ones.
    const container = document.querySelector('.MuiDialog-container') as HTMLElement;

    expect(container.className).toContain('pt-[4vh]');
    expect(container.className).not.toContain('mt-[6%]');
  });

  it('shows a fade at the bottom of the General tab while more settings are below', () => {
    render(<Panel />);
    const scrollArea = generalScrollArea();
    const fade = within(scrollArea).getByTestId('more-below-fade');

    expect(fade.getAttribute('data-visible')).toBe('true');
    scrollArea.scrollTop = 300;
    fireEvent.scroll(scrollArea);
    expect(fade.getAttribute('data-visible')).toBe('false');
  });

  it('shows no fade when the settings fit', () => {
    metrics.scrollHeight = 600;
    render(<Panel />);
    expect(within(generalScrollArea()).getByTestId('more-below-fade').getAttribute('data-visible')).toBe('false');
    metrics.scrollHeight = 700;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(within(generalScrollArea()).getByTestId('more-below-fade').getAttribute('data-visible')).toBe('true');
  });

  it('scrolls the Members tab the same way, with the same fade', () => {
    render(<Panel tab='members' />);
    const scrollArea = screen.getByTestId('members-list').closest('.overflow-y-auto') as HTMLElement;

    expect(classes(scrollArea)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']));
    expect(within(scrollArea).getByTestId('more-below-fade').getAttribute('data-visible')).toBe('true');
  });

  it('scrolls the Members tab of a private space the same way', () => {
    render(<Panel tab='members' visibility={SpaceVisibility.Private} />);
    const scrollArea = screen.getByTestId('private-space-owner-row').closest('.overflow-y-auto') as HTMLElement;

    expect(classes(scrollArea)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']));
    expect(scrollArea.className).not.toContain('max-h-[64vh]');
  });

  it('lines the footer buttons up with the settings above them, whatever width the scrollbar takes', () => {
    render(<Panel showActions />);
    const footer = screen.getByTestId('create-space-submit').parentElement as HTMLElement;
    const scrollArea = generalScrollArea();

    // Both reserve the same scrollbar gutter (none where scrollbars float) and the same 4px.
    for (const element of [footer, scrollArea]) {
      expect(classes(element)).toEqual(expect.arrayContaining(['[scrollbar-gutter:stable]', 'pr-1']));
    }

    expect(classes(footer)).toContain('overflow-y-auto');
  });
});
