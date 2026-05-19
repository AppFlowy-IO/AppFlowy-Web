Feature: Form Question Editing

  # Web counterpart of `appflowy_flutter/integration_test/desktop/bdd/database/form/form_question_editing.feature`.
  #
  # Exercises the per-question 3-dot menu's Required / Description /
  # Long answer toggles. Storage flows through `useFormWriter` →
  # per-view `form_field_settings` YJS Map; each toggle should ripple
  # to the question card's `data-required` / `data-description-visible`
  # / `data-long-answer` attributes on the next React commit.
  #
  # Long answer is only rendered for RichText questions (matches the
  # desktop's `_longAnswerVisible` gating on FieldType.RichText) — the
  # scenario adds a RichText question rather than relying on a seed.

  Background:
    Given a Grid with a Form tab is open

  Scenario: Toggling Required, Description, and Long answer ripples to the card
    When I add a "RichText" question
    Then the form has 1 question card

    # Required → `data-required="true"` on the card
    When I toggle "Required" on question 1
    Then question 1 is marked required

    # Description → `data-description-visible="true"` on the card
    When I toggle "Description" on question 1
    Then question 1 shows the description input

    # Long answer (RichText-only) → `data-long-answer="true"` on the card
    When I toggle "Long answer" on question 1
    Then question 1 uses the long answer body
