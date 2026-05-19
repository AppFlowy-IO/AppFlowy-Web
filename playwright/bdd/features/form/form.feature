Feature: Form View

  # Web counterpart of `appflowy_flutter/integration_test/desktop/bdd/database/form/form.feature`.
  #
  # The sidebar `+` menu on web does NOT include a Form layout — the
  # only entry point is the database tab-bar `+` button (see
  # `AddViewButton.tsx`). So every form scenario layers a Form view
  # onto an existing database. Mirrors the desktop's
  # `form_from_tab_bar.feature` shape.
  #
  # The Pro plan gate is bypassed by Vite DEV mode (mirror of the
  # desktop's `kDebugMode || isIntegrationTest` bypass — see
  # `useCanAuthorFormView`). Without that bypass a Free-plan workspace
  # would either hide the Form item (gated) or open the upgrade modal
  # on click.

  Background:
    Given a Grid with a Form tab is open

  Scenario: Form layout renders builder chrome with toolbar and access banner
    Then the form preview button is visible
    And the form share button is visible
    And the form access banner shows the workspace tier

  Scenario: Adding a Text question and opening the live preview
    When I add a "RichText" question
    Then the form has 1 question card
    When I open the form preview
    Then the form preview dialog is visible
    When I close the form preview
    Then the form preview dialog is hidden

  Scenario: Preview renders all supported field types
    # Mirrors desktop's `form_all_field_types.feature`. The picker's
    # supported set is RichText / Number / SingleSelect / MultiSelect /
    # Checkbox / DateTime / URL / Media — see
    # `FORM_QUESTION_FIELD_TYPES` in `FormQuestionTypePicker.tsx`.
    When I add a "RichText" question
    And I add a "Number" question
    And I add a "SingleSelect" question
    And I add a "MultiSelect" question
    And I add a "Checkbox" question
    And I add a "DateTime" question
    And I add a "URL" question
    And I add a "Media" question
    Then the form has 8 question cards
    When I open the form preview
    Then the form preview dialog is visible
