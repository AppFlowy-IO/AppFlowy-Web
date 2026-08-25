@database-row-page-mention @row-page-lifecycle
Feature: Paste database row page links as mentions

  Scenario: A row-page link becomes a styled database-row mention
    Given I am signed in with a new account
    And I have created a grid page named "Row Mention Grid"
    When I set the first grid cell to "PRJ-001"
    And I open the grid row named "PRJ-001" as a full row page
    And I remember the current database row page link
    And I have created and opened a document page named "Row Mention Target"
    And I type "Inside a Project page (example: " in the editor
    And I paste the remembered database row page link
    Then the Paste as menu is visible
    When I choose Mention from the Paste as menu
    Then the pasted database row mention is styled and labeled "PRJ-001"
