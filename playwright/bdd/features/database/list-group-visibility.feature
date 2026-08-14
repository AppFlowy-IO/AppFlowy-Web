Feature: List group visibility
  List grouping must use List-scoped settings and react immediately when a
  group is hidden or shown.

  # Migrated from database_list_grouping_test.dart.
  Scenario: list shows group headers and remove grouping option
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible
    And the List Remove grouping action is available

  Scenario: add row in group footer increases group count
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    And I add a row from List group "A" footer
    Then List group "A" has one more row

  Scenario: remove grouping clears list headers and hides action
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    And I remove List grouping
    Then the List has no group headers
    And the List Remove grouping action is not available

  Scenario: board grouping does not carry over to list layout and remove grouping is hidden
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I change the active database layout to Board
    And I group the Board by the Type field
    Then Board grouping cannot be removed
    When I change the active database layout to List
    Then the List has no group headers
    And the List Remove grouping action is not available

  Scenario: List page hides groups when visibility is toggled off
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    Then the List database is visible
    When I group the List by the Type field
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible
    When I hide List group "B" from group settings
    Then List group "A" is visible
    And List group "B" is not visible
    And List group "C" is visible
    When I show List group "B" from group settings
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible

  Scenario: List Hide empty groups hides an actual empty option and persists changes
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    And the grid has an empty List group option "Empty"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    Then List Hide empty groups is on
    And List group "Empty" is not visible
    When I toggle List Hide empty groups
    Then List Hide empty groups is off
    And List group "Empty" is visible
    When I switch away from and back to the List view
    Then List Hide empty groups is off
    And List group "Empty" is visible
    When I toggle List Hide empty groups
    Then List Hide empty groups is on
    And List group "Empty" is not visible
    When I switch away from and back to the List view
    Then List Hide empty groups is on
    And List group "Empty" is not visible
