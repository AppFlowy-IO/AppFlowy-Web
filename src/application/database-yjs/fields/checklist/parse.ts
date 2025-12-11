import { generateOptionId, SelectOption, SelectOptionColor } from '../select-option';

export interface ChecklistCellData {
  selectedOptionIds?: string[];
  options?: SelectOption[];
  percentage: number;
}

function normalizeChecklistOptions(options: SelectOption[] = []) {
  return options.filter((option): option is SelectOption => Boolean(option && option.id));
}

export function parseChecklistData(data: string): ChecklistCellData | null {
  try {
    const { options, selected_option_ids } = JSON.parse(data);
    const percentage = selected_option_ids.length / options.length;

    return {
      percentage,
      options,
      selectedOptionIds: selected_option_ids,
    };
  } catch (e) {
    return null;
  }
}

function parseChecklistTextToStruct(text: string): { options: SelectOption[]; selectedOptionIds: string[] } | null {
  const options: SelectOption[] = [];
  const selected: string[] = [];

  const lines = text.split('\n');

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) return;

    const match = trimmed.match(/^-?\s*(\[[xX ]\])?\s*(.*)$/);

    if (!match) return;
    const marker = match[1];
    const name = match[2]?.trim();

    if (!name) return;
    const isChecked = marker?.toLowerCase() === '[x]';

    const option: SelectOption = {
      id: generateOptionId(),
      name,
      color: SelectOptionColor.OptionColor1,
    };

    options.push(option);
    if (isChecked) selected.push(option.id);
  });

  if (!options.length) return null;

  return { options, selectedOptionIds: selected };
}

export function parseChecklistFlexible(data: string): ChecklistCellData | null {
  const parsed = parseChecklistData(data);

  if (parsed) {
    return parsed;
  }

  const fromText = parseChecklistTextToStruct(data);

  if (fromText) {
    const { options, selectedOptionIds } = fromText;
    const percentage = options.length === 0 ? 0 : selectedOptionIds.length / options.length;

    return { options, selectedOptionIds, percentage };
  }

  return null;
}

export function stringifyChecklist(options: SelectOption[], selected: string[]): string {
  return options
    .map((option) => {
      const checkbox = selected.includes(option.id) ? '[x]' : '[ ]';

      return `${checkbox} ${option.name}`;
    })
    .join('\n');
}

export function addTask(data: string, taskName: string): string {
  const parsedData = parseChecklistData(data);

  const task: SelectOption = {
    id: generateOptionId(),
    name: taskName,
    color: SelectOptionColor.OptionColor1,
  };

  if (!parsedData) {
    return JSON.stringify({
      options: [task],
      selected_option_ids: [],
    });
  }

  const { options = [], selectedOptionIds } = parsedData;
  const normalizedOptions = normalizeChecklistOptions(options);

  if (normalizedOptions.find((option) => option.id === task.id)) {
    return data;
  }

  return JSON.stringify({
    options: [...normalizedOptions, task],
    selected_option_ids: selectedOptionIds,
  });
}

export function toggleSelectedTask(data: string, taskId: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options, selectedOptionIds = [] } = parsedData;
  const normalizedOptions = normalizeChecklistOptions(options);

  const isSelected = selectedOptionIds.includes(taskId);
  const newSelectedOptionIds = isSelected
    ? selectedOptionIds.filter((id) => id !== taskId)
    : [...selectedOptionIds, taskId];

  return JSON.stringify({
    options: normalizedOptions,
    selected_option_ids: newSelectedOptionIds,
  });
}

export function updateTask(data: string, taskId: string, taskName: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options = [], selectedOptionIds } = parsedData;
  const normalizedOptions = normalizeChecklistOptions(options);

  const newOptions = normalizedOptions.map((option) => {
    if (option.id === taskId) {
      return {
        ...option,
        name: taskName,
      };
    }

    return option;
  });

  return JSON.stringify({
    options: newOptions,
    selected_option_ids: selectedOptionIds,
  });
}

export function removeTask(data: string, taskId: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options = [], selectedOptionIds = [] } = parsedData;
  const normalizedOptions = normalizeChecklistOptions(options);

  const newOptions = normalizedOptions.filter((option) => option.id !== taskId);
  const newSelectedOptionIds = selectedOptionIds.filter((id) => id !== taskId);

  return JSON.stringify({
    options: newOptions,
    selected_option_ids: newSelectedOptionIds,
  });
}

export function reorderTasks(data: string, { beforeId, taskId }: { beforeId?: string, taskId: string }): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { selectedOptionIds, options = [] } = parsedData;
  const normalizedOptions = normalizeChecklistOptions(options);

  const index = normalizedOptions.findIndex((opt) => opt.id === taskId);
  const option = normalizedOptions[index];

  if (index === -1) {
    return data;
  }

  const newOptions = [...normalizedOptions];
  const beforeIndex = newOptions.findIndex((opt) => opt.id === beforeId);

  if (beforeIndex === index) {
    return data;
  }

  newOptions.splice(index, 1);

  if (beforeId === undefined || beforeIndex === -1) {
    newOptions.unshift(option);
  } else {
    const targetIndex = beforeIndex > index ? beforeIndex - 1 : beforeIndex;

    newOptions.splice(targetIndex + 1, 0, option);
  }

  return JSON.stringify({
    options: newOptions,
    selected_option_ids: selectedOptionIds,
  });
}
