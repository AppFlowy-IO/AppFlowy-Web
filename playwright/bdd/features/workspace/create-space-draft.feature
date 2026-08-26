@create-space-draft @scp0822-space-permissions @mode:serial
Feature: Create Space keeps a local draft until confirmation
  Create Space shares the full settings presentation with Manage Space, but
  name, access and member edits remain local until the explicit Create action.

  Background:
    Given the seeded scp0822 space permission fixture exists

  Scenario: Cancelling a renamed Custom draft sends no mutations
    Given I sign in as seeded scp0822 "owner"
    When I start recording create-space draft mutations
    And I open the create-space draft panel
    And I rename the create-space draft to "Draft that must not persist"
    And I change the create-space draft type to "Custom"
    And I add "scp0822-member@appflowy.local" to the create-space draft
    And I change the create-space draft type to "Private"
    And the Private create-space draft shows owner-only access and roster
    And I change the create-space draft type to "Custom"
    Then the create-space draft has sent no mutations
    When I cancel the create-space draft
    Then the create-space draft has sent no mutations

  Scenario: Create persists one renamed Custom space before its queued member
    Given I sign in as seeded scp0822 "owner"
    When I start recording create-space draft mutations
    And I open the create-space draft panel
    And I rename the create-space draft to "BDD Deferred Custom Space"
    And I change the create-space draft type to "Private"
    And I change the create-space draft type to "Public"
    And I change the create-space draft type to "Custom"
    And I add "scp0822-member@appflowy.local" to the create-space draft
    Then the create-space draft has sent no mutations
    When I confirm the create-space draft
    Then one renamed Custom space and initial page are created before the queued member
    And the created create-space draft is visible as "BDD Deferred Custom Space"
    And the created space owner menu shows Manage Space and Duplicate Space

  Scenario: Eva can manage a default Public space she creates in the Nathan workspace
    Given I sign in as Eva and open the Nathan workspace for space creation
    When I start recording create-space draft mutations
    And I open the create-space draft panel
    And I rename the create-space draft to "BDD Member Public Space"
    And I confirm the create-space draft
    Then one default Public space and initial page are created through structured APIs
    And the created Public space grants Eva creator ownership via the API
    And the created create-space draft is visible as "BDD Member Public Space"
    And the created space owner menu shows Manage Space and Duplicate Space
