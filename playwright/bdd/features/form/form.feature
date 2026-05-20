Feature: Form Authoring

  # End-to-end coverage of the form-builder authoring surface: create
  # via tab-bar, observe the auto-create modal posture, dismiss, add a
  # representative spread of question types, exercise per-question
  # toggles, round-trip the live preview. Replaces what was previously
  # 5 separate scenarios (chrome render / single-question preview /
  # add-question / tab-bar modal / question editing).

  Scenario: Authoring flow from tab-bar through editing and preview
    # Start from a fresh Grid so the tab-bar add lands on the populated
    # default schema (Name / Type / Done = 3 supported fields), which
    # triggers the auto-create modal at > 2-field threshold.
    Given a Grid is open as a starter database
    When I add a Form view via the tab bar without dismissing modals
    Then the auto-create form questions dialog is visible

    # Start-from-scratch: the modal goes away, the form lands empty.
    When I click start from scratch in the auto-create form questions dialog
    Then the auto-create form questions dialog is hidden
    And the form has 0 question cards

    # Add a representative spread — Text (long_answer eligible),
    # Number (placeholder body), SingleSelect (option editor body).
    # The all-field-types catalog regression lives in its own scenario;
    # this one verifies the picker + per-type cards work end-to-end.
    When I add a "RichText" question
    And I add a "Number" question
    And I add a "SingleSelect" question
    Then the form has 3 question cards

    # 3-dot menu toggles ripple to the card's data-* attributes.
    # Required + Description are universal; Long answer is RichText-only.
    When I toggle "Required" on question 1
    Then question 1 is marked required
    When I toggle "Description" on question 1
    Then question 1 shows the description input
    When I toggle "Long answer" on question 1
    Then question 1 uses the long answer body

    # Live preview round-trip — mounts the dialog from the YJS draft,
    # closes cleanly on Escape.
    When I open the form preview
    Then the form preview dialog is visible
    When I close the form preview
    Then the form preview dialog is hidden

  Scenario: Preview renders every supported field type
    # Catalog regression: the picker's `FORM_QUESTION_FIELD_TYPES` set
    # must round-trip through the FormBody. Adding a new type to the
    # picker without updating this list lets a respondent-mode render
    # gap slip through.
    Given a Grid with a Form tab is open
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
