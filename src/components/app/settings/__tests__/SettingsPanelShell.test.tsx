import { act, render, screen } from '@testing-library/react';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';

import { SettingsPanelShell, SettingsSection } from '../billing/SettingsPanelShell';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) => (options?.title ? `${key}:${options.title}` : key),
  }),
}));

describe('SettingsSection', () => {
  it('explains a section through a labelled button that keyboard users can focus', async () => {
    render(
      <SettingsSection title='Space creation' tooltip='People who create a space become its owner.'>
        <p>Body</p>
      </SettingsSection>
    );
    const info = screen.getByRole('button', { name: 'settings.sectionInfo:Space creation' });

    expect(info.tagName).toBe('BUTTON');
    expect(info.getAttribute('type')).toBe('button');
    expect(info.hasAttribute('disabled')).toBe(false);
    expect(info.tabIndex).toBe(0);
    // Focus is visible, and the explanation opens on focus as well as on hover.
    expect(info.className).toMatch(/focus-visible:ring/);
    act(() => info.focus());
    expect(document.activeElement).toBe(info);
    expect((await screen.findByRole('tooltip')).textContent).toContain('People who create a space become its owner.');
    expect(info.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('names the info button in English and French with the section title', () => {
    expect(en.settings.sectionInfo).toBe('About {{title}}');
    expect(fr.settings.sectionInfo).toContain('{{title}}');
    expect(fr.settings.sectionInfo).not.toBe(en.settings.sectionInfo);
  });

  it('shows no info button without an explanation', () => {
    render(
      <SettingsSection title='Space creation'>
        <p>Body</p>
      </SettingsSection>
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Space creation')).toBeTruthy();
  });
});

describe('SettingsPanelShell', () => {
  it('shows a visible focus ring on every button in a settings panel', () => {
    render(
      <SettingsPanelShell title='Permissions' testId='panel'>
        <button type='button'>Manage groups</button>
      </SettingsPanelShell>
    );

    // The shared Button removes the browser outline, so the panel draws the focus ring for all of them.
    expect(screen.getByTestId('panel').className).toContain('[&_button:focus-visible]:ring-2');
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeTruthy();
  });
});
