Feature: Form View From Tab Bar

  # Web counterpart of `appflowy_flutter/integration_test/desktop/bdd/database/form/form_from_tab_bar.feature`.
  #
  # Adding a Form view to a database with > 2 supported fields fires
  # the auto-create modal (see `FormAutoCreate.tsx`). The default Grid
  # ships 3 fields (Name / Type / Done), all of which are in the form
  # picker's supported set — so the modal is guaranteed to fire here.
  #
  # The default `signInAndAddFormViewViaTabBar` helper auto-dismisses
  # this modal via Start-from-scratch, so this scenario uses the *raw*
  # variant that leaves the modal up to assert on.

  Scenario: Auto-create modal appears when adding Form onto a populated Grid
    Given a Grid is open as a starter database
    When I add a Form view via the tab bar without dismissing modals
    Then the auto-create form questions dialog is visible
    When I click start from scratch in the auto-create form questions dialog
    Then the auto-create form questions dialog is hidden
    And the form has 0 question cards
