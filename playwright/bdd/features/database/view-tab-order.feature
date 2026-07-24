Feature: Database view tab order
  New views created from the database tab bar must be appended to the end of
  the tab order, both immediately after creation and after navigating away and
  reopening the database.

  Scenario: Creating database views from the tab bar keeps them at the end after reopening
    Given a grid database is open for view tab order testing
    When I add a "Board" view from the database tab bar
    And I add a "Calendar" view from the database tab bar
    And I rename the database view tab "Board" to "Second View"
    And I rename the database view tab "Calendar" to "Third View"
    Then the database view tabs appear in order "Grid, Second View, Third View"
    When I navigate to another page and reopen the database
    Then the database view tabs appear in order "Grid, Second View, Third View"
