@dashboard @cloud
Feature: Dashboard layout editing
  In Edit mode widgets are dragged within a row, into another row, or between
  rows to start a new row; width handles move column shares between
  neighbours (a row always spans 12 columns) and height handles resize a row.
  Layout edits persist, undo and redo, and stack on narrow screens.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
      | 1   | Notes Grid    |
      | 2   | Tasks Grid #2 |

  Scenario: The insert-row control starts a new row below a row
    When I add the "Projects Grid" view through the insert-row control of dashboard row 1
    Then dashboard row 1 holds "Projects Grid, Tasks Grid, Notes Grid"
    And dashboard row 2 holds "Projects Grid"
    And dashboard row 3 holds "Tasks Grid #2"
    And every dashboard row spans 12 columns

  Scenario: Dragging a widget within its row reorders the row
    When I drag the "Projects Grid" widget onto the right side of the "Notes Grid" widget
    Then dashboard row 1 holds "Tasks Grid, Notes Grid, Projects Grid"
    And the dashboard has 2 rows
    And every dashboard row spans 12 columns

  Scenario: Dragging a widget into another row moves it and rebalances both rows
    When I drag the "Notes Grid" widget onto the right side of the "Tasks Grid #2" widget
    Then dashboard row 1 holds "Projects Grid, Tasks Grid"
    And dashboard row 2 holds "Tasks Grid #2, Notes Grid"
    And the widths of dashboard row 1 are "6, 6"
    And the widths of dashboard row 2 are "6, 6"

  Scenario: Dropping a widget between rows creates a new row
    When I drag the "Projects Grid" widget between dashboard rows 1 and 2
    Then the dashboard has 3 rows
    And dashboard row 1 holds "Tasks Grid, Notes Grid"
    And dashboard row 2 holds "Projects Grid"
    And dashboard row 3 holds "Tasks Grid #2"
    And every dashboard row spans 12 columns

  Scenario: The width handle snaps to columns and keeps the row at 12 columns
    When I drag width handle 1 of dashboard row 1 by 2 columns
    Then the widths of dashboard row 1 are "6, 2, 4"
    And every dashboard row spans 12 columns
    And the rendered widgets of dashboard row 1 follow their widths

  Scenario: The height handle resizes a row
    When I drag the height handle of dashboard row 2 down by 120 px
    Then dashboard row 2 is about 480 px tall
    And dashboard row 1 is about 360 px tall

  Scenario: Layout changes persist after a reload
    When I drag width handle 1 of dashboard row 1 by 2 columns
    And I drag the height handle of dashboard row 1 down by 120 px
    And I wait for the dashboard layout to reach the server
    And I reload the dashboard
    Then the dashboard is in View mode
    And the widths of dashboard row 1 are "6, 2, 4"
    And dashboard row 1 is about 480 px tall
    And the rendered widgets of dashboard row 1 follow their widths

  Scenario: Undo and redo replay a layout change
    When I drag the "Projects Grid" widget onto the right side of the "Notes Grid" widget
    Then dashboard row 1 holds "Tasks Grid, Notes Grid, Projects Grid"
    When I press the dashboard undo shortcut
    Then dashboard row 1 holds "Projects Grid, Tasks Grid, Notes Grid"
    When I press the dashboard redo shortcut
    Then dashboard row 1 holds "Tasks Grid, Notes Grid, Projects Grid"

  Scenario: The widget menu moves a widget left, right, down and up
    When I choose "move-left" in the "Tasks Grid" widget menu
    Then dashboard row 1 holds "Tasks Grid, Projects Grid, Notes Grid"
    When I choose "move-right" in the "Tasks Grid" widget menu
    Then dashboard row 1 holds "Projects Grid, Tasks Grid, Notes Grid"
    When I choose "move-down" in the "Tasks Grid" widget menu
    Then the "Tasks Grid" widget is in dashboard row 2
    And dashboard row 1 holds "Projects Grid, Notes Grid"
    When I choose "move-up" in the "Tasks Grid" widget menu
    Then the "Tasks Grid" widget is in dashboard row 1
    And every dashboard row spans 12 columns

  Scenario: A narrow window stacks the widgets of a row
    When the browser window is 600 px wide
    Then the widgets of dashboard row 1 are stacked
    When the browser window is 1440 px wide
    Then the widgets of dashboard row 1 are side by side
