import fs from 'fs';
import path from 'path';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';

type Dictionary = { [key: string]: string | Dictionary };

const SOURCES = ['WorkspacePermissionsPanel.tsx', 'GroupSpaceCoverageControl.tsx', 'SettingMenu.tsx'].map((file) =>
  path.join(__dirname, '..', file)
);
const KEY_PATTERN = /'((?:workspacePermissions|groupSpaceAccess|shareAction|button|settings\.appearance\.people)\.[A-Za-z0-9_.]+|loading)'/g;
const POLICIES = ['members_and_owners', 'owners_only', 'owners_and_selected_members'];
// Owned by other settings areas (Manage Space sidebar policy, paused edits).
const OTHER_OWNERS = /^workspacePermissions\.(sidebar|pendingEdits|legacyPendingEdits|retryPendingEdits)/;
// The People menu itself is not translated into French yet, so the summary must name it exactly as shown.
const UNTRANSLATED_MENU = /^settings\.appearance\.people\./;
// Labels the page Share menus show side by side. French must have all of them or none, never a mix.
const SHARE_MENU_LEVELS = [
  'readOnly',
  'readAndWrite',
  'canView',
  'canComment',
  'canViewAndComment',
  'canEdit',
  'fullAccess',
  'canViewDescription',
  'canEditDescription',
];

function lookup(dictionary: Dictionary, key: string): string | Dictionary | undefined {
  return key.split('.').reduce<string | Dictionary | undefined>(
    (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
    dictionary
  );
}

function resolves(dictionary: Dictionary, key: string): boolean {
  if (typeof lookup(dictionary, key) === 'string') return true;
  return typeof lookup(dictionary, `${key}_one`) === 'string' && typeof lookup(dictionary, `${key}_other`) === 'string';
}

function flatten(dictionary: Dictionary, prefix: string): Record<string, string> {
  return Object.entries(dictionary).reduce<Record<string, string>>((result, [key, value]) => {
    const dotted = `${prefix}.${key}`;

    return typeof value === 'string' ? { ...result, [dotted]: value } : { ...result, ...flatten(value, dotted) };
  }, {});
}

const usedKeys = Array.from(
  new Set([
    ...SOURCES.flatMap((file) => Array.from(fs.readFileSync(file, 'utf8').matchAll(KEY_PATTERN), (match) => match[1])),
    ...POLICIES.flatMap((policy) => [
      `workspacePermissions.policies.${policy}`,
      `workspacePermissions.policyDescriptions.${policy}`,
    ]),
  ])
).sort();

const translatedKeys = usedKeys.filter((key) => !UNTRANSLATED_MENU.test(key));
const menuKeys = usedKeys.filter((key) => UNTRANSLATED_MENU.test(key));

describe('permission settings translations', () => {
  it('finds the keys used by the permission settings', () => {
    expect(usedKeys).toEqual(
      expect.arrayContaining([
        'button.retry',
        'groupSpaceAccess.canEdit',
        'groupSpaceAccess.canView',
        'groupSpaceAccess.confirmTitle',
        'loading',
        'workspacePermissions.savedSelections',
      ])
    );
    expect(menuKeys).toEqual(['settings.appearance.people.groupsTab', 'settings.appearance.people.label']);
  });

  it.each(translatedKeys)('%s exists in English and French', (key) => {
    expect(resolves(en as Dictionary, key)).toBe(true);
    expect(resolves(fr as Dictionary, key)).toBe(true);
  });

  it.each(menuKeys)('%s exists in English and names the People menu as French users see it', (key) => {
    expect(resolves(en as Dictionary, key)).toBe(true);
    // Until the menu is translated, French falls back to the English name, and so does the summary.
    expect(resolves(fr as Dictionary, key)).toBe(false);
  });

  it('labels access levels with its own keys, not the shared Share menu labels', () => {
    expect(usedKeys.filter((key) => key.startsWith('shareAction.'))).toEqual([]);
  });

  it('never translates only part of the Share menu access labels into French', () => {
    const translated = SHARE_MENU_LEVELS.filter((key) => resolves(fr as Dictionary, `shareAction.${key}`));

    expect([[], SHARE_MENU_LEVELS]).toContainEqual(translated);
  });

  it('translates every permission settings string into French', () => {
    const english = {
      ...flatten(en.workspacePermissions as Dictionary, 'workspacePermissions'),
      ...flatten(en.groupSpaceAccess as Dictionary, 'groupSpaceAccess'),
    };
    const french = {
      ...flatten(fr.workspacePermissions as Dictionary, 'workspacePermissions'),
      ...flatten(fr.groupSpaceAccess as Dictionary, 'groupSpaceAccess'),
    };
    const owned = Object.keys(english).filter((key) => !OTHER_OWNERS.test(key));

    expect(owned.filter((key) => !french[key])).toEqual([]);
    expect(owned.filter((key) => french[key] === english[key])).toEqual([]);
    // French has plural categories English lacks (i18next `_many`), so a French-only plural form is
    // valid when English pluralizes the same base key; anything else is a stale French key.
    const frenchOnlyPlural = (key: string) => {
      const match = /^(.*)_(zero|two|few|many)$/.exec(key);

      return Boolean(match && `${match[1]}_other` in english);
    };

    expect(Object.keys(french).filter((key) => !(key in english) && !frenchOnlyPlural(key))).toEqual([]);
  });

  it('uses plain words instead of internal terms', () => {
    const copy = Object.entries({
      ...flatten(en.workspacePermissions as Dictionary, 'workspacePermissions'),
      ...flatten(en.groupSpaceAccess as Dictionary, 'groupSpaceAccess'),
    })
      .filter(([key]) => !OTHER_OWNERS.test(key))
      .map(([, value]) => value)
      .join('\n');

    expect(copy).not.toMatch(/entitlement|override|inherit|tombstone|principal|revision|provenance|UUID|\(s\)/i);
  });
});
