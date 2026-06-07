export enum GroupColorOption {
  DefaultOption = 'defaultOption',
  Mauve = 'mauve',
  Lilac = 'lilac',
  Camellia = 'camellia',
  Papaya = 'papaya',
  Mango = 'mango',
  Olive = 'olive',
  Grass = 'grass',
  Jade = 'jade',
  Azure = 'azure',
  Iron = 'iron',
}

export const GROUP_COLOR_OPTIONS = Object.values(GroupColorOption);

export function groupColorOptionFromName(name: string | undefined): GroupColorOption | undefined {
  if (!name) return undefined;
  return GROUP_COLOR_OPTIONS.find((option) => option === name);
}

export function groupColorOptionByName(name: string): GroupColorOption {
  if (!name) return GroupColorOption.DefaultOption;

  let hash = 0;

  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }

  const index = Math.abs(hash) % (GROUP_COLOR_OPTIONS.length - 1);

  return GROUP_COLOR_OPTIONS[index + 1];
}
