import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { useEffect } from 'react';

export function useNavigationKey ({
  onToggleSelectedTask,
  onCreateTask,
  element,
}: {
  onToggleSelectedTask: (taskId: string) => void;
  onCreateTask: () => void;
  element: HTMLElement | null;
}) {

  useEffect(() => {
    if (!element) {
      return;
    }

    // Add event listeners for keydown and click events
    const handleKeyDown = (event: KeyboardEvent) => {
      const isEnter = createHotkey(HOT_KEY_NAME.ENTER)(event);
      const isToggleChecked = createHotkey(HOT_KEY_NAME.TOGGLE_TODO)(event);
      const isArrowDown = createHotkey(HOT_KEY_NAME.DOWN)(event);
      const isArrowUp = createHotkey(HOT_KEY_NAME.UP)(event);
      const isTab = createHotkey(HOT_KEY_NAME.TAB)(event);

      const target = event.target as HTMLElement;

      if (!target || !target.dataset || !target.dataset.taskId) {
        return;
      }

      const taskId = target.dataset.taskId;

      const taskTargets = element.querySelectorAll('[data-task-id]');
      const taskIds = Array.from(taskTargets).map((task) => (task as HTMLInputElement).dataset.taskId);
      const index = taskIds.indexOf(taskId);

      const focusedNextTask = () => {
        const nextTaskIndex = index === taskIds.length - 1 ? 0 : index + 1;
        const nextTask = taskTargets[nextTaskIndex] as HTMLElement;

        if (nextTask && nextTask.dataset && nextTask.dataset.taskId) {
          nextTask.focus();
        }
      };

      const focusedPrevTask = () => {
        const prevTaskIndex = index === 0 ? taskIds.length - 1 : index - 1;
        const prevTask = taskTargets[prevTaskIndex] as HTMLElement;

        if (prevTask && prevTask.dataset && prevTask.dataset.taskId) {
          prevTask.focus();
        }
      };

      switch (true) {
        case isEnter:
          event.preventDefault();
          if (taskId === 'create') {
            onCreateTask();
          } else {
            // Handle enter key action for focused next task
            focusedNextTask();
          }

          break;
        case isToggleChecked:
          event.preventDefault();
          if (taskId === 'create') {
            break;
          } else {
            onToggleSelectedTask(taskId);
          }

          break;
        case isArrowDown:
          event.preventDefault();
          if (taskId === 'create') {
            break;
          } else {
            focusedNextTask();
          }

          break;
        case isArrowUp:
          console.log('ArrowUp', taskId);
          event.preventDefault();
          focusedPrevTask();
          break;
        case isTab:
          event.preventDefault();
          if (taskId === 'create') {
            break;
          } else {
            focusedNextTask();
          }

          break;
        default:
          break;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target && target.dataset && target.dataset.taskId) {
        target.focus();
      }
    };

    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('click', handleClick);

    // Cleanup event listeners on component unmount
    return () => {
      element.removeEventListener('keydown', handleKeyDown);
      element.removeEventListener('click', handleClick);
    };

  }, [onCreateTask, onToggleSelectedTask, element]);

}