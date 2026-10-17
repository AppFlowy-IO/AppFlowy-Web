Feature: Board group visibility
  The Board "Group" menu mirrors desktop's DatabaseGroupList: the settings
  entry names the grouping field, "Group by" opens a nested field picker, and
  every column, the "No Status" column included, is a Groups row whose eye
  icon reflects whether the Board currently renders it. There is no
  "Show ungrouped items" switch and no bulk Show all / Hide all.

  Scenario: The Group menu names the field and lists every column with an eye icon
    Given a Board database is open for group behavior testing
    When I open Board Group settings
    Then the Board Group entry shows "Status" as the current field
    And Board Group settings expose no ungrouping action
    And the Board Groups list has no bulk visibility actions
    And the Board Groups list offers exactly "No Status, To Do, Doing, Done"
    And the Board Groups list shows "No Status" as shown
    And the Board Groups list shows "To Do" as shown
    And the Board Group by submenu ticks "Status"
    When I close Board Group settings

  Scenario: Hiding a column from its menu flips its eye and the Groups row shows it again
    Given a Board database is open for group behavior testing
    When I hide the "Doing" Board column from its column menu
    Then the Board has no visible column named "Doing"
    And the Board Groups list shows "Doing" as hidden
    When I toggle the Board Groups row "Doing"
    Then the Board shows the column named "Doing"
    And the Board Groups list shows "Doing" as shown

  Scenario: The No Status column is an ordinary Groups row
    Given a Board database is open for group behavior testing
    Then the Board shows the column named "No Status"
    When I toggle the Board Groups row "No Status"
    Then the Board has no visible column named "No Status"
    And the Board Groups list shows "No Status" as hidden
    When I expand the Board Hidden Groups section
    Then Hidden Groups has exactly one "No Status" row with only a show action
    When I toggle the Board Groups row "No Status"
    Then the Board shows the column named "No Status"
    And the Board Groups list shows "No Status" as shown

  Scenario: The eye on an auto-hidden empty group reveals it and records the override
    Given a Board database is open for group behavior testing
    And an empty Board group named "BDD Eye Empty Group" exists
    When I enable Hide empty groups for the Board
    Then the Board has no visible column named "BDD Eye Empty Group"
    And the Board Groups list shows "BDD Eye Empty Group" as hidden
    When I toggle the Board Groups row "BDD Eye Empty Group"
    Then the Board has exactly one visible empty column named "BDD Eye Empty Group"
    And the Board Groups list shows "BDD Eye Empty Group" as shown
    And the Board layout setting lists "BDD Eye Empty Group" among its shown empty groups
    When I expand the Board Hidden Groups section
    Then Hidden Groups has exactly one "BDD Eye Empty Group" row with only a hide action
    When I toggle the Board Groups row "BDD Eye Empty Group"
    Then the Board has no visible column named "BDD Eye Empty Group"
    And the Board Groups list shows "BDD Eye Empty Group" as hidden
    And the Board layout setting does not list "BDD Eye Empty Group" among its shown empty groups
