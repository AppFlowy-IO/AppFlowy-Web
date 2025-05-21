import { generateUUID } from '@/application/database-yjs';
import { SelectOption, SelectOptionColor } from '../select-option';

export interface ChecklistCellData {
  selectedOptionIds?: string[];
  options?: SelectOption[];
  percentage: number;
}

export function parseChecklistData (data: string): ChecklistCellData | null {
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

export function addTask (data: string, taskName: string): string {
  const parsedData = parseChecklistData(data);

  const task: SelectOption = {
    id: generateUUID(),
    name: taskName,
    color: SelectOptionColor.Purple,
  };

  if (!parsedData) {
    return JSON.stringify({
      options: [task],
      selected_option_ids: [],
    });
  }

  const { options = [], selectedOptionIds } = parsedData;

  if (options.find((option) => option.id === task.id)) {
    return data;
  }

  return JSON.stringify({
    options: [...options, task],
    selected_option_ids: selectedOptionIds,
  });
}

export function toggleSelectedTask (data: string, taskId: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options, selectedOptionIds = [] } = parsedData;

  const isSelected = selectedOptionIds.includes(taskId);
  const newSelectedOptionIds = isSelected
    ? selectedOptionIds.filter((id) => id !== taskId)
    : [...selectedOptionIds, taskId];

  return JSON.stringify({
    options,
    selected_option_ids: newSelectedOptionIds,
  });
}

export function updateTask (data: string, taskId: string, taskName: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options = [], selectedOptionIds } = parsedData;

  const newOptions = options.map((option) => {
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

export function removeTask (data: string, taskId: string): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { options = [], selectedOptionIds = [] } = parsedData;

  const newOptions = options.filter((option) => option.id !== taskId);
  const newSelectedOptionIds = selectedOptionIds.filter((id) => id !== taskId);

  return JSON.stringify({
    options: newOptions,
    selected_option_ids: newSelectedOptionIds,
  });
}

export function reorderTasks (data: string, newTasks: SelectOption[]): string {
  const parsedData = parseChecklistData(data);

  if (!parsedData) {
    return data;
  }

  const { selectedOptionIds } = parsedData;

  return JSON.stringify({
    options: newTasks,
    selected_option_ids: selectedOptionIds,
  });
}