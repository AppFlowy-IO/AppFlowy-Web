import { Page, Locator } from '@playwright/test';

/**
 * Centralized selectors for Playwright E2E tests
 * Migrated from: cypress/support/selectors.ts
 *
 * In Playwright, selectors return Locators (lazy, auto-waiting).
 * Each selector group takes a Page (or parent Locator) as the first argument.
 */

// Re-export FieldType from the source to avoid duplication
export { FieldType } from '../../src/application/database-yjs/database.type';

/**
 * Helper function to create a data-testid selector string
 */
export function byTestId(id: string): string {
  return `[data-testid="${id}"]`;
}

export function byTestIdPrefix(prefix: string): string {
  return `[data-testid^="${prefix}"]`;
}

export function byTestIdContains(fragment: string): string {
  return `[data-testid*="${fragment}"]`;
}

/**
 * Extracts a viewId from a sidebar page item test id (e.g. "page-<viewId>").
 */
export function viewIdFromPageTestId(testId: string | null | undefined): string {
  if (!testId || !testId.startsWith('page-')) {
    throw new Error(`Expected data-testid to start with "page-" but got: ${String(testId)}`);
  }
  return testId.slice('page-'.length);
}

/**
 * Page-related selectors
 */
export const PageSelectors = {
  items: (page: Page) => page.getByTestId('page-item'),
  names: (page: Page) => page.getByTestId('page-name'),
  pageByViewId: (page: Page, viewId: string) => page.getByTestId(`page-${viewId}`).first(),
  itemByViewId: (page: Page, viewId: string) =>
    PageSelectors.pageByViewId(page, viewId).locator('xpath=ancestor::*[@data-testid="page-item"]').first(),
  nameContaining: (page: Page, text: string) => page.getByTestId('page-name').filter({ hasText: text }),
  itemByName: (page: Page, pageName: string) =>
    page.getByTestId('page-name').filter({ hasText: pageName }).first().locator('xpath=ancestor::*[@data-testid="page-item"]').first(),
  moreActionsButton: (page: Page, pageName?: string) => {
    if (pageName) {
      return PageSelectors.itemByName(page, pageName).getByTestId('page-more-actions').first();
    }
    return page.getByTestId('page-more-actions');
  },
  newPageButton: (page: Page) => page.getByTestId('new-page-button'),
  titleInput: (page: Page) => page.getByTestId('page-title-input'),
};

/**
 * Page Icon selectors
 */
export const PageIconSelectors = {
  pageIcon: (page: Page) => page.getByTestId('page-icon'),
  pageIconImage: (page: Page) => page.getByTestId('page-icon-image'),
  viewMetaHoverArea: (page: Page) => page.getByTestId('view-meta-hover-area'),
  addIconButton: (page: Page) => page.getByTestId('add-icon-button'),
  iconPopoverTabEmoji: (page: Page) => page.getByTestId('icon-popover-tab-emoji'),
  iconPopoverTabIcon: (page: Page) => page.getByTestId('icon-popover-tab-icon'),
  iconPopoverTabUpload: (page: Page) => page.getByTestId('icon-popover-tab-upload'),
  fileDropzone: (page: Page) => page.getByTestId('file-dropzone'),
};

/**
 * Space selectors
 */
export const SpaceSelectors = {
  items: (page: Page) => page.getByTestId('space-item'),
  names: (page: Page) => page.getByTestId('space-name'),
  expanded: (page: Page) => page.getByTestId('space-expanded'),
  itemByName: (page: Page, spaceName: string) =>
    page.getByTestId('space-name').filter({ hasText: spaceName }).locator('xpath=ancestor::*[@data-testid="space-item"]').first(),
  moreActionsButton: (page: Page) => page.getByTestId('inline-more-actions'),
  createNewSpaceButton: (page: Page) => page.getByTestId('create-new-space-button'),
  createSpaceModal: (page: Page) => page.getByTestId('create-space-modal'),
  spaceNameInput: (page: Page) => page.getByTestId('space-name-input'),
};

/**
 * Breadcrumb selectors
 */
export const BreadcrumbSelectors = {
  navigation: (page: Page) => page.getByTestId('breadcrumb-navigation'),
  items: (page: Page) => page.locator(byTestIdContains('breadcrumb-item-')),
};

/**
 * View actions popover selectors
 */
export const ViewActionSelectors = {
  popover: (page: Page) => page.getByTestId('view-actions-popover'),
  deleteButton: (page: Page) => page.getByTestId('view-action-delete'),
  renameButton: (page: Page) => page.getByTestId('more-page-rename'),
  changeIconButton: (page: Page) => page.getByTestId('more-page-change-icon'),
  openNewTabButton: (page: Page) => page.getByTestId('more-page-open-new-tab'),
  duplicateButton: (page: Page) => page.getByTestId('more-page-duplicate'),
  moveToButton: (page: Page) => page.getByTestId('more-page-move-to'),
};

/**
 * Modal selectors
 */
export const ModalSelectors = {
  confirmDeleteButton: (page: Page) => page.getByTestId('confirm-delete-button'),
  deletePageModal: (page: Page) => page.getByTestId('delete-page-confirm-modal'),
  newPageModal: (page: Page) => page.getByTestId('new-page-modal'),
  spaceItemInModal: (page: Page) => page.getByTestId('space-item'),
  okButton: (page: Page) => page.getByTestId('modal-ok-button'),
  renameInput: (page: Page) => page.getByTestId('rename-modal-input'),
  renameSaveButton: (page: Page) => page.getByTestId('rename-modal-save'),
  dialogContainer: (page: Page) => page.locator('.MuiDialog-container'),
  dialogRole: (page: Page) => page.locator('[role="dialog"]'),
  addButton: (page: Page) => page.getByRole('button', { name: 'Add' }),
};

/**
 * Dropdown/Menu selectors
 */
export const DropdownSelectors = {
  content: (page: Page) => page.locator('[data-slot="dropdown-menu-content"]'),
  menu: (page: Page) => page.locator('[role="menu"]'),
  menuItem: (page: Page) => page.locator('[role="menuitem"]'),
};

/**
 * Share/Publish selectors
 */
export const ShareSelectors = {
  shareButton: (page: Page) => page.getByTestId('share-button').first(),
  sharePopover: (page: Page) => page.getByTestId('share-popover'),
  emailTagInput: (page: Page) => page.locator('[data-slot="email-tag-input"]'),
  inviteButton: (page: Page) => page.getByRole('button', { name: /invite/i }),
  publishTabButton: (page: Page) => page.getByTestId('publish-tab-button'),
  publishSwitch: (page: Page) => page.getByTestId('publish-switch'),
  publishUrlInput: (page: Page) => page.getByTestId('publish-url-input'),
  publishNamespace: (page: Page) => page.getByTestId('publish-namespace'),
  publishNameInput: (page: Page) => page.getByTestId('publish-name-input'),
  openPublishSettingsButton: (page: Page) => page.getByTestId('open-publish-settings'),
  pageSettingsButton: (page: Page) => page.getByTestId('page-settings-button'),
  publishSettingsTab: (page: Page) => page.getByTestId('publish-settings-tab'),
  unpublishButton: (page: Page) => page.getByTestId('unpublish-button'),
  confirmUnpublishButton: (page: Page) => page.getByTestId('confirm-unpublish-button'),
  publishConfirmButton: (page: Page) => page.getByTestId('publish-confirm-button'),
  visitSiteButton: (page: Page) => page.getByTestId('visit-site-button'),
  publishManageModal: (page: Page) => page.getByTestId('publish-manage-modal'),
  publishManagePanel: (page: Page) => page.getByTestId('publish-manage-panel'),
  editNamespaceButton: (page: Page) => page.getByTestId('edit-namespace-button'),
  homePageSetting: (page: Page) => page.getByTestId('homepage-setting'),
  homePageUpgradeButton: (page: Page) => page.getByTestId('homepage-upgrade-button'),
};

/**
 * Workspace selectors
 */
export const WorkspaceSelectors = {
  dropdownTrigger: (page: Page) => page.getByTestId('workspace-dropdown-trigger'),
  dropdownContent: (page: Page) => page.getByTestId('workspace-dropdown-content'),
  item: (page: Page) => page.getByTestId('workspace-item'),
  itemName: (page: Page) => page.getByTestId('workspace-item-name'),
  memberCount: (page: Page) => page.getByTestId('workspace-member-count'),
};

/**
 * Sidebar selectors
 */
export const SidebarSelectors = {
  pageHeader: (page: Page) => page.getByTestId('sidebar-page-header'),
};

/**
 * Header selectors (top bar)
 */
export const HeaderSelectors = {
  container: (page: Page) => page.locator('.appflowy-top-bar'),
  moreActionsButton: (page: Page) => page.locator('.appflowy-top-bar').getByTestId('page-more-actions'),
};

/**
 * Trash selectors
 */
export const TrashSelectors = {
  sidebarTrashButton: (page: Page) => page.getByTestId('sidebar-trash-button'),
  table: (page: Page) => page.getByTestId('trash-table'),
  rows: (page: Page) => page.getByTestId('trash-table-row'),
  cell: (page: Page) => page.locator('td'),
  restoreButton: (page: Page) => page.getByTestId('trash-restore-button'),
  deleteButton: (page: Page) => page.getByTestId('trash-delete-button'),
};

/**
 * Chat Model Selector selectors
 */
export const ModelSelectorSelectors = {
  button: (page: Page) => page.getByTestId('model-selector-button'),
  searchInput: (page: Page) => page.getByTestId('model-search-input'),
  options: (page: Page) => page.locator('[data-testid^="model-option-"]'),
  optionByName: (page: Page, modelName: string) => page.getByTestId(`model-option-${modelName}`),
  selectedOption: (page: Page) => page.locator('[data-testid^="model-option-"]').filter({ has: page.locator('.bg-fill-content-select') }),
};

/**
 * Chat UI selectors
 */
export const ChatSelectors = {
  aiChatContainer: (page: Page) => page.getByTestId('ai-chat-container'),
  formatToggle: (page: Page) => page.getByTestId('chat-input-format-toggle'),
  formatGroup: (page: Page) => page.getByTestId('chat-format-group'),
  browsePromptsButton: (page: Page) => page.getByTestId('chat-input-browse-prompts'),
  relatedViewsButton: (page: Page) => page.getByTestId('chat-input-related-views'),
  relatedViewsPopover: (page: Page) => page.getByTestId('chat-related-views-popover'),
  sendButton: (page: Page) => page.getByTestId('chat-input-send'),
};

/**
 * Database Grid selectors
 */
export const DatabaseGridSelectors = {
  grid: (page: Page) => page.getByTestId('database-grid'),
  rows: (page: Page) => page.locator('[data-testid^="grid-row-"]'),
  rowById: (page: Page, rowId: string) => page.getByTestId(`grid-row-${rowId}`),
  firstRow: (page: Page) => page.locator('[data-testid^="grid-row-"]').first(),
  dataRows: (page: Page) => page.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])'),
  cells: (page: Page) => page.locator('[data-testid^="grid-cell-"]'),
  cellByIds: (page: Page, rowId: string, fieldId: string) => page.getByTestId(`grid-cell-${rowId}-${fieldId}`),
  cellsInRow: (page: Page, rowId: string) => page.locator(`[data-testid^="grid-cell-${rowId}-"]`),
  cellsForField: (page: Page, fieldId: string) => page.locator(`[data-testid$="-${fieldId}"][data-testid^="grid-cell-"]`),
  dataRowCellsForField: (page: Page, fieldId: string) =>
    page.locator(`[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"]) .grid-row-cell[data-column-id="${fieldId}"]`),
  firstCell: (page: Page) => page.locator('[data-testid^="grid-cell-"]').first(),
  newRowButton: (page: Page) => page.getByTestId('grid-new-row'),
};

/**
 * Database View selectors
 */
export const DatabaseViewSelectors = {
  viewTab: (page: Page, viewId?: string) =>
    viewId ? page.getByTestId(`view-tab-${viewId}`) : page.locator('[data-testid^="view-tab-"]'),
  activeViewTab: (page: Page) => page.locator('[data-testid^="view-tab-"][data-state="active"]'),
  tabActionRename: (page: Page) => page.getByTestId('database-view-action-rename'),
  tabActionDelete: (page: Page) => page.getByTestId('database-view-action-delete'),
  deleteViewConfirmButton: (page: Page) => page.getByTestId('database-view-delete-confirm'),
  viewNameInput: (page: Page) => page.getByTestId('view-name-input'),
  addViewButton: (page: Page) => page.getByTestId('add-view-button'),
  gridView: (page: Page) => page.getByTestId('grid-view'),
  boardView: (page: Page) => page.locator('[data-testid*="board"]'),
  calendarView: (page: Page) => page.locator('[data-testid*="calendar"]'),
};

/**
 * Database Filter & Sort selectors
 */
export const DatabaseFilterSelectors = {
  filterButton: (page: Page) => page.getByTestId('database-actions-filter'),
  addFilterButton: (page: Page) => page.getByTestId('database-add-filter-button'),
  sortButton: (page: Page) => page.getByTestId('database-actions-sort'),
  filterCondition: (page: Page) => page.getByTestId('database-filter-condition'),
  sortCondition: (page: Page) => page.getByTestId('database-sort-condition'),
  deleteFilterButton: (page: Page) => page.getByTestId('delete-filter-button'),
  filterInput: (page: Page) => page.getByTestId('text-filter-input'),
  textFilter: (page: Page) => page.getByTestId('text-filter'),
  filterConditionOption: (page: Page, conditionValue: number) => page.getByTestId(`filter-condition-${conditionValue}`),
  propertyItem: (page: Page, fieldId: string) => page.locator(`[data-item-id="${fieldId}"]`),
  propertyItemByName: (page: Page, name: string) => page.locator('[data-item-id]').filter({ hasText: name }),
  filterMoreOptionsButton: (page: Page) => page.getByTestId('filter-more-options-button'),
  advancedFiltersBadge: (page: Page) => page.getByTestId('advanced-filters-badge'),
  filterOperatorToggle: (page: Page) =>
    page.locator('[data-slot="dropdown-menu-trigger"]').filter({ hasText: /And|Or/ }),
  deleteAllFiltersButton: (page: Page) => page.getByRole('button', { name: /delete filter/i }),
};

/**
 * Editor selectors
 */
export const EditorSelectors = {
  slateEditor: (page: Page) => page.locator('[data-slate-editor="true"]'),
  firstEditor: (page: Page) => page.locator('[data-slate-editor="true"]').first(),
  selectionToolbar: (page: Page) => page.getByTestId('selection-toolbar'),
  boldButton: (page: Page) => page.getByTestId('toolbar-bold-button'),
  italicButton: (page: Page) => page.getByTestId('toolbar-italic-button'),
  underlineButton: (page: Page) => page.getByTestId('toolbar-underline-button'),
  strikethroughButton: (page: Page) => page.getByTestId('toolbar-strikethrough-button'),
  codeButton: (page: Page) => page.getByTestId('toolbar-code-button'),
  linkButton: (page: Page) => page.getByTestId('link-button'),
  textColorButton: (page: Page) => page.getByTestId('text-color-button'),
  bgColorButton: (page: Page) => page.getByTestId('bg-color-button'),
  headingButton: (page: Page) => page.getByTestId('heading-button'),
  heading1Button: (page: Page) => page.getByTestId('heading-1-button'),
};

/**
 * DateTime Column selectors
 */
export const DateTimeSelectors = {
  dateTimeCell: (page: Page, rowId: string, fieldId: string) => page.getByTestId(`datetime-cell-${rowId}-${fieldId}`),
  allDateTimeCells: (page: Page) => page.locator('[data-testid^="datetime-cell-"]'),
  dateTimePickerPopover: (page: Page) => page.getByTestId('datetime-picker-popover'),
  dateTimeDateInput: (page: Page) => page.getByTestId('datetime-date-input'),
  dateTimeTimeInput: (page: Page) => page.getByTestId('datetime-time-input'),
};

/**
 * Property Menu selectors
 */
export const PropertyMenuSelectors = {
  propertyTypeTrigger: (page: Page) => page.getByTestId('property-type-trigger'),
  propertyTypeOption: (page: Page, fieldType: number) => page.getByTestId(`property-type-option-${fieldType}`),
  newPropertyButton: (page: Page) => page.getByTestId('grid-new-property-button'),
  editPropertyMenuItem: (page: Page) => page.getByTestId('grid-field-edit-property'),
};

/**
 * Single Select Column selectors
 */
export const SingleSelectSelectors = {
  selectOptionCell: (page: Page, rowId: string, fieldId: string) => page.getByTestId(`select-option-cell-${rowId}-${fieldId}`),
  allSelectOptionCells: (page: Page) => page.locator('[data-testid^="select-option-cell-"]'),
  selectOption: (page: Page, optionId: string) => page.getByTestId(`select-option-${optionId}`),
  selectOptionMenu: (page: Page) => page.getByTestId('select-option-menu'),
};

/**
 * Person Column selectors
 */
export const PersonSelectors = {
  personCell: (page: Page, rowId: string, fieldId: string) => page.getByTestId(`person-cell-${rowId}-${fieldId}`),
  allPersonCells: (page: Page) => page.locator('[data-testid^="person-cell-"]'),
  personCellMenu: (page: Page) => page.getByTestId('person-cell-menu'),
  notifyAssigneeToggle: (page: Page) => page.getByTestId('person-cell-menu').locator('[role="switch"]'),
  personOption: (page: Page, personId: string) => page.getByTestId(`person-option-${personId}`),
};

/**
 * Grid Field/Column Header selectors
 */
export const GridFieldSelectors = {
  fieldHeader: (page: Page, fieldId: string) => page.getByTestId(`grid-field-header-${fieldId}`),
  allFieldHeaders: (page: Page) => page.locator('[data-testid^="grid-field-header-"]'),
  addSelectOptionButton: (page: Page) => page.getByTestId('add-select-option'),
};

/**
 * Checkbox Column selectors
 */
export const CheckboxSelectors = {
  checkboxCell: (page: Page, rowId: string, fieldId: string) => page.getByTestId(`checkbox-cell-${rowId}-${fieldId}`),
  allCheckboxCells: (page: Page) => page.locator('[data-testid^="checkbox-cell-"]'),
  checkedIcon: (page: Page) => page.getByTestId('checkbox-checked-icon'),
  uncheckedIcon: (page: Page) => page.getByTestId('checkbox-unchecked-icon'),
  checkedCells: (page: Page) => page.locator('[data-checked="true"]'),
  uncheckedCells: (page: Page) => page.locator('[data-checked="false"]'),
};

/**
 * Row Controls selectors
 */
export const RowControlsSelectors = {
  rowAccessoryButton: (page: Page) => page.getByTestId('row-accessory-button'),
  rowMenuDuplicate: (page: Page) => page.getByTestId('row-menu-duplicate'),
  rowMenuInsertAbove: (page: Page) => page.getByTestId('row-menu-insert-above'),
  rowMenuInsertBelow: (page: Page) => page.getByTestId('row-menu-insert-below'),
  rowMenuDelete: (page: Page) => page.getByTestId('row-menu-delete'),
  deleteRowConfirmButton: (page: Page) => page.getByTestId('delete-row-confirm-button'),
};

/**
 * Auth selectors
 */
export const AuthSelectors = {
  emailInput: (page: Page) => page.getByTestId('login-email-input'),
  magicLinkButton: (page: Page) => page.getByTestId('login-magic-link-button'),
  enterCodeManuallyButton: (page: Page) => page.getByTestId('enter-code-manually-button'),
  otpCodeInput: (page: Page) => page.getByTestId('otp-code-input'),
  otpSubmitButton: (page: Page) => page.getByTestId('otp-submit-button'),
  passwordSignInButton: (page: Page) => page.getByTestId('login-password-button'),
  passwordInput: (page: Page) => page.getByTestId('password-input'),
  passwordSubmitButton: (page: Page) => page.getByTestId('password-submit-button'),
  createAccountButton: (page: Page) => page.getByTestId('login-create-account-button'),
  logoutMenuItem: (page: Page) => page.getByTestId('logout-menu-item'),
  logoutConfirmButton: (page: Page) => page.getByTestId('logout-confirm-button'),
};

/**
 * Sign Up selectors
 */
export const SignUpSelectors = {
  emailInput: (page: Page) => page.getByTestId('signup-email-input'),
  passwordInput: (page: Page) => page.getByTestId('signup-password-input'),
  confirmPasswordInput: (page: Page) => page.getByTestId('signup-confirm-password-input'),
  submitButton: (page: Page) => page.getByTestId('signup-submit-button'),
  backToLoginButton: (page: Page) => page.getByTestId('signup-back-to-login-button'),
};

/**
 * Account settings selectors
 */
export const AccountSelectors = {
  settingsButton: (page: Page) => page.getByTestId('account-settings-button'),
  settingsDialog: (page: Page) => page.getByTestId('account-settings-dialog'),
  dateFormatDropdown: (page: Page) => page.getByTestId('date-format-dropdown'),
  dateFormatOptionYearMonthDay: (page: Page) => page.getByTestId('date-format-1'),
  timeFormatDropdown: (page: Page) => page.getByTestId('time-format-dropdown'),
  timeFormatOption24: (page: Page) => page.getByTestId('time-format-1'),
  startWeekDropdown: (page: Page) => page.getByTestId('start-week-on-dropdown'),
  startWeekMonday: (page: Page) => page.getByTestId('start-week-1'),
};

/**
 * Add Page Actions selectors
 */
export const AddPageSelectors = {
  inlineAddButton: (page: Page) => page.getByTestId('inline-add-page'),
  addGridButton: (page: Page) => page.getByTestId('add-grid-button'),
  addCalendarButton: (page: Page) => page.getByTestId('add-calendar-button'),
  addBoardButton: (page: Page) => page.getByTestId('add-board-button'),
  addAIChatButton: (page: Page) => page.getByTestId('add-ai-chat-button'),
};

/**
 * Block selectors
 */
export const BlockSelectors = {
  dragHandle: (page: Page) => page.getByTestId('drag-block'),
  hoverControls: (page: Page) => page.getByTestId('hover-controls'),
  slashMenuGrid: (page: Page) => page.getByTestId('slash-menu-grid'),
  blockByType: (page: Page, type: string) => page.locator(`[data-block-type="${type}"]`),
  allBlocks: (page: Page) => page.locator('[data-block-type]'),
};

/**
 * Sort selectors
 */
export const SortSelectors = {
  sortButton: (page: Page) => page.getByTestId('database-actions-sort'),
  sortCondition: (page: Page) => page.getByTestId('database-sort-condition'),
  sortItem: (page: Page) => page.getByTestId('sort-condition'),
  addSortButton: (page: Page) => page.getByRole('button', { name: /add.*sort/i }),
  deleteAllSortsButton: (page: Page) => page.getByRole('button', { name: /delete.*all.*sort/i }),
};

/**
 * Calendar selectors (FullCalendar)
 */
export const CalendarSelectors = {
  calendarContainer: (page: Page) => page.locator('.fc'),
  toolbar: (page: Page) => page.locator('.fc-toolbar'),
  prevButton: (page: Page) => page.locator('.fc-prev-button'),
  nextButton: (page: Page) => page.locator('.fc-next-button'),
  todayButton: (page: Page) => page.locator('.fc-today-button'),
  monthViewButton: (page: Page) => page.locator('.fc-dayGridMonth-button'),
  weekViewButton: (page: Page) => page.locator('.fc-timeGridWeek-button'),
  dayViewButton: (page: Page) => page.locator('.fc-timeGridDay-button'),
  title: (page: Page) => page.locator('.fc-toolbar-title'),
  dayCell: (page: Page) => page.locator('.fc-daygrid-day'),
  dayCellByDate: (page: Page, dateStr: string) => page.locator(`[data-date="${dateStr}"]`),
  todayCell: (page: Page) => page.locator('.fc-day-today'),
  event: (page: Page) => page.locator('.fc-event'),
  eventTitle: (page: Page) => page.locator('.fc-event-title'),
  moreLink: (page: Page) => page.locator('.fc-more-link, .fc-daygrid-more-link'),
};

/**
 * Board View selectors
 */
export const BoardSelectors = {
  boardContainer: (page: Page) => page.locator('.database-board'),
  columns: (page: Page) => page.locator('[class*="board-column"], [data-testid*="board-column"]'),
  cards: (page: Page) => page.locator('.board-card'),
  cardByRowId: (page: Page, rowId: string) => page.locator(`[data-card-id*="${rowId}"]`),
  cardContent: (page: Page) => page.locator('.board-card .truncate'),
  columnHeaders: (page: Page) => page.locator('[class*="column-header"], [data-testid*="column-header"]'),
  newCardButton: (page: Page) => page.getByText('+ New'),
};

/**
 * Row Detail Modal selectors
 */
export const RowDetailSelectors = {
  modal: (page: Page) => page.locator('.MuiDialog-paper'),
  modalContent: (page: Page) => page.locator('.MuiDialogContent-root'),
  modalTitle: (page: Page) => page.locator('.MuiDialogTitle-root'),
  closeButton: (page: Page) => page.locator('.MuiDialogTitle-root button').first(),
  moreActionsButton: (page: Page) => page.locator('.MuiDialogTitle-root button').last(),
  documentArea: (page: Page) => page.locator('.appflowy-scroll-container'),
  duplicateMenuItem: (page: Page) => page.locator('[role="menuitem"]').filter({ hasText: /duplicate/i }),
  deleteMenuItem: (page: Page) => page.locator('[role="menuitem"]').filter({ hasText: /delete/i }),
  titleInput: (page: Page) => page.getByTestId('row-title-input'),
  deleteRowConfirmButton: (page: Page) => page.getByTestId('delete-row-confirm-button'),
};

/**
 * Version History selectors
 */
export const VersionHistorySelectors = {
  menuItem: (page: Page) => page.getByTestId('more-page-version-history'),
  modal: (page: Page) => page.getByTestId('version-history-modal'),
  list: (page: Page) => page.getByTestId('version-history-list'),
  items: (page: Page) => page.locator('[data-testid^="version-history-item-"]'),
  itemById: (page: Page, versionId: string) => page.getByTestId(`version-history-item-${versionId}`),
  restoreButton: (page: Page) => page.getByTestId('version-history-restore-button'),
  closeButton: (page: Page) => page.getByTestId('version-history-close-button'),
};

/**
 * Slash Command selectors
 */
export const SlashCommandSelectors = {
  slashPanel: (page: Page) => page.getByTestId('slash-panel'),
  slashMenuItem: (page: Page, name: string) => page.locator('[data-testid^="slash-menu-"]').filter({ hasText: name }),
  heading1: (page: Page) => page.getByTestId('slash-menu-heading1'),
  bulletedList: (page: Page) => page.getByTestId('slash-menu-bulletedList'),
  searchInput: (page: Page) => page.locator('input[placeholder*="Search"]'),
  /** Select a database from the linked database picker popover */
  selectDatabase: async (page: Page, dbName: string) => {
    const popover = page.locator('.MuiPopover-paper').last();
    await popover.waitFor({ state: 'visible', timeout: 10000 });
    const searchInput = popover.locator('input[placeholder*="Search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.clear();
      await searchInput.fill(dbName);
    }
    await page.waitForTimeout(2000);
    await popover.locator('span').filter({ hasText: dbName }).first().locator('xpath=ancestor::div').first().click({ force: true });
  },
};

/**
 * Avatar display selectors
 */
export const AvatarUiSelectors = {
  image: (page: Page) => page.getByTestId('avatar-image'),
};

/**
 * Reverted Dialog selectors
 */
export const RevertedDialogSelectors = {
  dialog: (page: Page) => page.getByTestId('reverted-dialog'),
  confirmButton: (page: Page) => page.getByTestId('reverted-dialog-confirm'),
};
