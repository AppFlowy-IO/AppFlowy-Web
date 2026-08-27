@database-row-page-mention @row-page-lifecycle
Feature: Render database row page mentions

  Scenario: A web-created row-page mention keeps the row title
    Given I am signed in with a new account
    And I have created a grid page named "Portfolio"
    When I set the first grid cell to "PRJ-001"
    And I open the grid row named "PRJ-001" as a full row page
    And I remember the current database row page link
    And I have created and opened a document page named "Row Mention Target"
    And I type "Inside a Project page (example: " in the editor
    And I paste the remembered database row page link
    Then the Paste as menu is visible
    When I choose Mention from the Paste as menu
    Then the database row mention is styled and labeled "PRJ-001"
    And the database row mention is not labeled "Portfolio"
    And the stored database row mention includes its database id

  Scenario: A desktop-synced row-page mention keeps the row title
    Given I am signed in with a new account
    And I have created a grid page named "By Status"
    When I set the first grid cell to "EPC-001"
    And I open the grid row named "EPC-001" as a full row page
    And I remember the current database row page link
    And I have created and opened a document page named "Desktop Row Mention Target"
    And I type "Inside an Epic page (example: " in the editor
    And the document receives a desktop-authored database row mention labeled "EPC-001"
    Then the database row mention is styled and labeled "EPC-001"
    And the database row mention is not labeled "By Status"
    And the stored database row mention omits its database id
