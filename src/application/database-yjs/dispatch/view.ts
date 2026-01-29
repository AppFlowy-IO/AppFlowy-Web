/**
 * Database view dispatch hooks
 *
 * TODO: Move these hooks from ../dispatch.ts here:
 * - useAddDatabaseView
 * - useUpdateDatabaseLayout
 * - useUpdateDatabaseView
 * - useDeleteView
 * - useCreateCalendarEvent
 * - useUpdateCalendarSetting
 */

// Re-export from main dispatch.ts for now (incremental refactoring)
export {
  useAddDatabaseView,
  useUpdateDatabaseLayout,
  useUpdateDatabaseView,
  useDeleteView,
  useCreateCalendarEvent,
  useUpdateCalendarSetting,
} from '../dispatch';
