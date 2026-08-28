Feature: Board grouping defaults
  Board views must always remain grouped, including a newly added view of an
  existing database.

  Scenario: Board hides ungrouping actions and a new Board view defaults to Status grouping
    Given a Board database is open for group behavior testing
    When I open Board Group settings
    Then Board Group settings expose no ungrouping action
    And Board Group settings show exactly one selected field named "Status"
    When I close Board Group settings
    And I add another Board view from the database tab bar
    And I open Board Group settings
    Then Board Group settings expose no ungrouping action
    And Board Group settings show exactly one selected field named "Status"
