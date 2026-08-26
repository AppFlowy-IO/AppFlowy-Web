@space-creator-management @create-space-draft @mode:serial
Feature: A workspace member retains management of a space they create
  A workspace member who creates a space is its owner and can manage it.

  Scenario: Eva can manage a default Public space she creates in the Nathan workspace
    Given I sign in as Eva and open the Nathan workspace for space creation
    When I start recording create-space draft mutations
    And I open the create-space draft panel
    And I rename the create-space draft to "BDD Member Public Space"
    And I confirm the create-space draft
    Then one default Public space and initial page are created through structured APIs
    And the created create-space draft is visible as "BDD Member Public Space"
    And the created space owner menu shows Manage Space and Duplicate Space
    And the created Public space grants Eva creator ownership via the API
