Feature: List group visibility
  List grouping must use List-scoped settings and react immediately when a
  group is hidden or shown. The Group menu follows desktop's DatabaseGroupList:
  a nested "Group by" field picker, "Groups" rows with eye icons instead of
  switches or bulk actions, and a "Delete grouping" action.

  # Migrated from database_list_grouping_test.dart.
  Scenario: list shows group headers and delete grouping option
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible
    And the List Delete grouping action is available

  Scenario: add row in group footer increases group count
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    And I add a row from List group "A" footer
    Then List group "A" has one more row

  Scenario: delete grouping clears list headers and hides action
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    And I delete List grouping
    Then the List has no group headers
    And the List Delete grouping action is not available

  Scenario: board grouping does not carry over to list layout and delete grouping is hidden
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I change the active database layout to Board
    And I group the Board by the Type field
    Then Board grouping cannot be removed
    When I change the active database layout to List
    Then the List has no group headers
    And the List Delete grouping action is not available

  Scenario: the Group by submenu switches the grouping field and Checkbox grouping has no Hide empty groups toggle
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    And the grid has a Checkbox field checked on the first row
    When I add a List view for group visibility testing
    And I group the List by the Type field
    Then the List Group entry shows "Type" as the current field
    And the List Group by submenu ticks "Type"
    And List Hide empty groups is on
    And the List Groups list has no bulk visibility actions
    When I group the List by the Checkbox field through the Group by submenu
    Then the List Group entry shows "Checkbox" as the current field
    And the List shows Checkbox group headers for "Checkbox" reading "Yes, No"
    And the List has no Hide empty groups toggle
    And the List Groups list offers the groups "Yes, No" as shown
    And the List Delete grouping action is available

  Scenario: List page hides groups when visibility is toggled off
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    When I add a List view for group visibility testing
    Then the List database is visible
    When I group the List by the Type field
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible
    And the List Groups list shows "B" as shown
    When I hide List group "B" from group settings
    Then List group "A" is visible
    And List group "B" is not visible
    And List group "C" is visible
    And the List Groups list shows "B" as hidden
    When I show List group "B" from group settings
    Then List group "A" is visible
    And List group "B" is visible
    And List group "C" is visible
    And the List Groups list shows "B" as shown

  Scenario: List Hide empty groups hides an actual empty option and persists changes
    Given a grid database is open for List group visibility testing
    And the grid has List group options "A, B, C"
    And the grid has an empty List group option "Empty"
    When I add a List view for group visibility testing
    And I group the List by the Type field
    Then List Hide empty groups is on
    And List group "Empty" is not visible
    And the List Groups list does not offer "Empty"
    When I toggle List Hide empty groups
    Then List Hide empty groups is off
    And List group "Empty" is visible
    And the List Groups list shows "Empty" as shown
    When I hide List group "Empty" from group settings
    Then List group "Empty" is not visible
    And the List Groups list shows "Empty" as hidden
    When I show List group "Empty" from group settings
    Then List group "Empty" is visible
    When I switch away from and back to the List view
    Then List Hide empty groups is off
    And List group "Empty" is visible
    When I toggle List Hide empty groups
    Then List Hide empty groups is on
    And List group "Empty" is not visible
    And the List Groups list does not offer "Empty"
    When I switch away from and back to the List view
    Then List Hide empty groups is on
    And List group "Empty" is not visible
