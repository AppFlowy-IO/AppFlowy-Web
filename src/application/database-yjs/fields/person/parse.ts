import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { PersonCellData, PersonTypeOption } from './person.type';

function parsePersons(value: unknown): PersonTypeOption['persons'] {
  if (Array.isArray(value)) return value as PersonTypeOption['persons'];
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? (parsed as PersonTypeOption['persons']) : [];
  } catch {
    return [];
  }
}

export function parsePersonTypeOptions(field: YDatabaseField) {
  const typeOptions = getTypeOptions(field);
  const content = typeOptions?.get(YjsDatabaseKey.content);
  const storedPersons = parsePersons(typeOptions?.get(YjsDatabaseKey.persons));

  if (!content) {
    return {
      persons: storedPersons,
    };
  }

  try {
    const parsed = JSON.parse(content) as PersonTypeOption;

    return {
      ...parsed,
      persons: parsed.persons?.length ? parsed.persons : storedPersons,
    };
  } catch (e) {
    return {
      persons: storedPersons,
    };
  }
}

export function parsePersonCellData(field: YDatabaseField, data: string): PersonCellData | null {
  const users = parsePersonTypeOptions(field)?.persons;

  if (!data) return null;

  try {
    const userIds = JSON.parse(data);

    return { users: users.filter((user) => userIds.includes(user.id)) };
  } catch (e) {
    return null;
  }
}
