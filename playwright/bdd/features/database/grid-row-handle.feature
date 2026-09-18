Feature: Drag rows using the grid row handle
  Regression for https://github.com/AppFlowy-IO/AppFlowy/issues/9023.

  Scenario: The row handle distinguishes dragging from opening its menu
    Given a blank document page is open
    And a full-page grid with 33 rows is ready for handle dragging
    When I drag the "empty" grid row above the first row using its handle
    Then the grid row order changes without opening the row menu
    When I drag the "named" grid row above the first row using its handle
    Then the grid row order changes without opening the row menu
    And the grid row menu still opens by click and keyboard
