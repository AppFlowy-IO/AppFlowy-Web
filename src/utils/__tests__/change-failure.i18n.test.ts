import i18next from 'i18next';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import { ERROR_CODE } from '@/application/constants';
import { ClientValidationError } from '@/application/errors/client-validation-error';
import { changeFailureReason } from '@/utils/change-failure';

type Dictionary = { [key: string]: string | Dictionary };

function flatten(dictionary: Dictionary | undefined, prefix = ''): Record<string, string> {
  return Object.entries(dictionary ?? {}).reduce<Record<string, string>>((result, [key, value]) => {
    const dotted = prefix ? `${prefix}.${key}` : key;

    return typeof value === 'string' ? { ...result, [dotted]: value } : { ...result, ...flatten(value, dotted) };
  }, {});
}

const english = en as unknown as Dictionary;
const french = fr as unknown as Dictionary;

// The permission screens prefer the shared error catalog's words over their own generic copy, so a
// French reader must get that catalog in French even when the server sends no French catalog.
describe('permission screen failures for a French reader', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'fr-FR',
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'fr-FR': { translation: fr } },
    });
  });

  it('explains a server failure in French without a server catalog', () => {
    const t = i18next.t.bind(i18next);
    const unavailable = changeFailureReason({ code: 500, httpStatus: 500, message: 'pool timed out' }, t);
    const invalid = changeFailureReason({ code: ERROR_CODE.INVALID_REQUEST, message: 'user 42 is invalid' }, t);

    expect(unavailable).toBe('AppFlowy est momentanément indisponible. Réessayez plus tard.');
    expect(invalid).toBe('Cette demande n’est pas valide.');
    expect(changeFailureReason(new ClientValidationError('ATOMIC_CREATION_PENDING'), t)).toBe(
      (french.atomicCreation as Dictionary).pending
    );
  });

  it.each(['userError', 'userErrorDetail', 'atomicCreation'])('has French for every %s key', (namespace) => {
    const frenchKeys = flatten(french[namespace] as Dictionary | undefined);
    const englishKeys = flatten(english[namespace] as Dictionary);
    const missing = Object.keys(englishKeys).filter((key) => !frenchKeys[key]?.trim());

    // userError follows the Cloud catalog: copy new reasons from
    // AppFlowy-Cloud-Premium libs/app-error/resources/locales/fr.json.
    expect(missing).toEqual([]);
    for (const [key, text] of Object.entries(englishKeys)) {
      // Interpolated values must survive the translation.
      expect([...frenchKeys[key].matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort()).toEqual(
        [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort()
      );
    }
  });
});
