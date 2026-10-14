import fs from 'fs';
import path from 'path';

import i18next, { i18n } from 'i18next';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';

/**
 * The component tests stub `t`, so this checks the real strings behind the
 * per-person access (A) and page creation (P) controls in Manage/Create Space.
 * The level names are also the General tab's, so both tabs use one vocabulary.
 */
const SHARED_VOCABULARY: Record<string, string> = {
  'space.memberOverride.label': 'Access',
  // A column header has no "this" person: it explains the whole column.
  'space.memberOverride.explanation':
    'Choose what each person or group can do in this space, or keep the space default. Sharing a page can still give access, and restricted pages stay restricted.',
  'space.memberOverride.levels.canView': 'Can view',
  'space.memberOverride.levels.canComment': 'Can comment',
  'space.memberOverride.levels.canEdit': 'Can edit',
  'space.memberOverride.levels.fullAccess': 'Full access',
  'space.memberOverride.levels.noAccess': 'No access',
  'space.memberOverride.inheritedNoAccess':
    'Space members get no access by default. Choose access for specific members or groups, or change the default in General.',
  'space.memberOverride.updated': 'Access updated',
  'workspacePermissions.sidebarPolicy': 'Who can add pages to this space',
  'workspacePermissions.sidebarOwners': 'Only space owners',
  // Who counts as a space member differs by space type (see policy/space.rs on the server).
  'workspacePermissions.sidebarMembers': 'Space members who can edit',
  'workspacePermissions.sidebarWorkspaceMembers': 'Workspace members who can edit',
  'workspacePermissions.sidebarExplanation':
    'Applies to pages added directly to the space. Pages inside other pages follow their own permissions.',
  'space.permissionManager.checkAgain': 'Check again',
};

// Every string these controls can show.
const CONTROL_KEYS = [
  ...Object.keys(SHARED_VOCABULARY),
  'space.memberOverride.accessFor',
  'space.memberOverride.unknown',
  'space.memberOverride.unavailable',
  'space.memberOverride.contextChanged',
  'space.memberOverride.identityUnavailable',
  'space.memberOverride.updateFailed',
  'space.memberOverride.spaceDefault',
  'space.memberOverride.defaultSuffix',
  'space.memberOverride.levels.noAccess',
  'space.memberOverride.sharedPagesOnly',
  'space.memberOverride.sharedPagesReason',
  'space.memberOverride.managedElsewhere',
  'space.memberOverride.reloadToChange',
  'workspacePermissions.sidebarUnknown',
  'space.permissionManager.memberRoleDescription',
  'space.permissionManager.memberRoleWithAccessDescription',
  'space.permissionManager.fullAccessMembersDescription',
  'space.permissionManager.accessCheckFailed',
  'space.permissionManager.accessLost',
  'space.memberOverride.extraAccess.view',
  'space.memberOverride.extraAccess.comment',
  'space.memberOverride.extraAccess.edit',
  'space.memberOverride.extraAccess.full',
  'space.memberOverride.extraAccessSource.group',
  'space.memberOverride.extraAccessSource.anyGroup',
  'space.memberOverride.extraAccessSource.allSpaces',
  'space.memberOverride.extraAccessSource.anyAllSpaces',
  'space.memberOverride.extraAccessSource.pageShare',
];

const INTERNAL_TERMS = /override|inherit|assignment|entitlement|principal|uuid|provenance|tombstone|revision|roster/i;

// Confirmations reached from General (type, full access, group owners), the Role menu's description
// and the Create space callout.
const SENTENCE_CASE_KEYS = [
  'space.permissionManager.memberRoleDescription',
  'space.permissionManager.switchToCustomDescription',
  'space.permissionManager.confirmToCustomTitle',
  'space.permissionManager.confirmPublicToCustomDescription',
  'space.permissionManager.confirmPrivateToCustomDescription',
  'space.permissionManager.confirmToPublicTitle',
  'space.permissionManager.confirmToPublicDescription',
  'space.permissionManager.confirmToPublicAction',
  'space.permissionManager.confirmToPrivateTitle',
  'space.permissionManager.confirmToPrivateDescription',
  'space.permissionManager.confirmToPrivateAction',
  'space.permissionManager.fullAccessMembersTitle',
  'space.permissionManager.fullAccessMembersDescription',
  'space.permissionManager.fullAccessEveryoneElseTitle',
  'space.permissionManager.fullAccessEveryoneElseDescription',
  'space.permissionManager.fullAccessWorkspaceMembersTitle',
  'space.permissionManager.fullAccessWorkspaceMembersDescription',
  'space.permissionManager.grantFullAccess',
  'space.permissionManager.groupOwnerTitle',
  'space.permissionManager.groupOwnerDescription',
  'space.permissionManager.groupOwnerAction',
];

/** Capitalized permission words after the first word of a sentence, outside a quoted option name. */
function midSentenceCapitals(value: string): string[] {
  const unquoted = value.replace(/“[^”]*”/g, '“”');

  return unquoted.split(/(?<=[.?!])\s+/).flatMap((sentence) => {
    const rest = sentence.split(' ').slice(1).join(' ');

    return Array.from(rest.matchAll(/\b(Space|Spaces|Workspace|Public|Private|Custom|Full|Grant|Can)\b/g), (m) => m[0]);
  });
}

function lookup(resources: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, resources);
}

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/{{\s*(\w+)\s*}}/g), (match) => match[1]).sort();
}

async function createI18n(lng: string): Promise<i18n> {
  const instance = i18next.createInstance();

  await instance.init({
    lng,
    fallbackLng: false,
    resources: { en: { translation: en }, fr: { translation: fr } },
  });

  return instance;
}

describe('space access copy', () => {
  it('uses the shared Web and Desktop vocabulary in English', () => {
    for (const [key, expected] of Object.entries(SHARED_VOCABULARY)) {
      expect({ key, value: lookup(en, key) }).toEqual({ key, value: expected });
    }
  });

  it('builds the default option and trigger labels from the level names', async () => {
    const english = await createI18n('en');
    const french = await createI18n('fr');
    const level = english.t('space.memberOverride.levels.canEdit');

    expect(english.t('space.memberOverride.spaceDefault', { level })).toBe('Space default (Can edit)');
    expect(english.t('space.memberOverride.defaultSuffix', { level })).toBe('Can edit · default');
    expect(
      french.t('space.memberOverride.defaultSuffix', { level: french.t('space.memberOverride.levels.canView') })
    ).toBe('Lecture · par défaut');
    expect(english.t('space.memberOverride.accessFor', { name: 'R&D', interpolation: { escapeValue: false } })).toBe(
      'Access for R&D'
    );
  });

  it('says in plain words where more access comes from', async () => {
    const english = await createI18n('en');
    const french = await createI18n('fr');
    const noEscape = { interpolation: { escapeValue: false } };

    expect(
      english.t('space.memberOverride.extraAccess.edit', {
        source: english.t('space.memberOverride.extraAccessSource.allSpaces', { name: 'R&D', ...noEscape }),
        ...noEscape,
      })
    ).toBe('You can also edit this space through Access to all spaces (R&D).');
    expect(
      english.t('space.memberOverride.extraAccess.full', {
        source: english.t('space.memberOverride.extraAccessSource.group', { name: 'Owners', ...noEscape }),
        ...noEscape,
      })
    ).toBe('You also have full access to this space through the Owners group.');
    expect(
      french.t('space.memberOverride.extraAccess.edit', {
        source: french.t('space.memberOverride.extraAccessSource.pageShare'),
        ...noEscape,
      })
    ).toBe('Vous pouvez aussi modifier cet espace via un partage de page.');
  });

  it('translates every string into French with the same placeholders', () => {
    for (const key of CONTROL_KEYS) {
      const english = lookup(en, key);
      const french = lookup(fr, key);

      expect({ key, english: typeof english }).toEqual({ key, english: 'string' });
      expect({ key, french: typeof french }).toEqual({ key, french: 'string' });
      expect({ key, placeholders: placeholders(french as string) }).toEqual({
        key,
        placeholders: placeholders(english as string),
      });
    }
  });

  it('describes the space types in sentence case, in English and in French', () => {
    // The card descriptions under Public / Custom / Private in Create and Manage Space.
    expect(lookup(en, 'space.publicPermissionDescription')).toBe('Everyone in the workspace can access');
    expect(lookup(en, 'space.customPermissionDescription')).toBe('Choose who can access and what they can do');
    expect(lookup(en, 'space.privatePermissionDescription')).toBe('Only you can access');
    expect(lookup(fr, 'space.publicPermissionDescription')).toBe("Tout le monde dans l'espace de travail peut y accéder");
  });

  it('titles the space menu, its tooltip and its dialogs in sentence case, like Create space', () => {
    for (const file of ['ManageSpace.tsx', 'MoreSpaceActions.tsx', 'SpaceSidebarActions.tsx']) {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

      expect({ file, titleCase: /'space\.manage'/.test(source) }).toEqual({ file, titleCase: false });
      expect({ file, sentenceCase: /'space\.manageSpace'/.test(source) }).toEqual({ file, sentenceCase: true });
    }

    expect(lookup(en, 'space.manage')).toBeUndefined();
    expect(lookup(en, 'space.manageSpace')).toBe('Manage space');
    expect(lookup(en, 'space.createSpace')).toBe('Create space');
    expect(lookup(en, 'space.duplicate')).toBe('Duplicate space');
    expect(lookup(fr, 'space.manageSpace')).toBe("Gérer l'espace");
    expect(lookup(fr, 'space.createSpace')).toBe('Créer un espace');
    expect(lookup(fr, 'space.duplicate')).toBe("Dupliquer l'espace");
  });

  it('keeps the confirmations about space types and full access in sentence case, in English and French', () => {
    for (const key of SENTENCE_CASE_KEYS) {
      const english = lookup(en, key);
      const french = lookup(fr, key);

      expect({ key, english: typeof english }).toEqual({ key, english: 'string' });
      // Option names keep their capital only when quoted as a label: “Custom”, “Can edit”.
      expect({ key, capitals: midSentenceCapitals(english as string) }).toEqual({ key, capitals: [] });
      expect({ key, french: typeof french }).toEqual({ key, french: 'string' });
      expect({ key, untranslated: french === english }).toEqual({ key, untranslated: false });
    }

    expect(lookup(en, 'space.permissionManager.switchToCustomDescription')).toContain('a custom space');
  });

  it('keeps internal permission terms out of the visible copy', () => {
    for (const key of CONTROL_KEYS) {
      expect({ key, value: lookup(en, key) }).toEqual({ key, value: expect.not.stringMatching(INTERNAL_TERMS) });
    }
  });
});
