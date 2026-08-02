Feature: Nested database interoperability
  Nested inline databases inside row pages should preserve their identity and
  content across navigation, realtime clients, and internal page links.

  Scenario: A nested inline database keeps its title, editable row, and synchronized row count
    Given a nested inline database in a database row page is open
    And another web client opens the same database row page
    Then the nested database title is "New Database"
    When I add nested database row "BDD nested row"
    Then the other web client's nested database row count increases by 1
    And the other web client shows nested database row "BDD nested row"
    And nested database row "BDD nested row" remains after reopening the row page

  Scenario: Renaming a nested database title synchronizes and persists
    Given a nested inline database in a database row page is open
    And another web client opens the same database row page
    When I rename nested database title "New Database" to "Synced Nested Database"
    Then the nested database title is "Synced Nested Database"
    And the other web client's nested database title is "Synced Nested Database"
    And nested database title "Synced Nested Database" remains after reopening the row page

  Scenario: Creating and renaming a nested database view synchronizes to another web client
    Given a nested inline database in a database row page is open
    And another web client opens the same database row page
    When I add a "Board" view to the nested database
    And I rename nested database tab "Board" to "Synced Board"
    Then the other web client shows nested database tab "Synced Board"
    And nested database tab "Synced Board" remains after reopening the row page

  Scenario: A nested database view link uses the view name
    Given a nested inline database in a database row page is open
    When I rename nested database tab "Grid" to "Linked Grid"
    And I paste the nested database view link into another document
    Then the pasted page reference is labeled "Linked Grid"
