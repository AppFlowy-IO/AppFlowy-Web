@dashboard @cloud
Feature: Undo and redo Save for everybody from a dashboard
  Saving private dashboard conditions is one undoable action even when its
  widgets use different databases. Undo follows the button's current history
  scope, and preserves changes another editor made after the save.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |

  # Invite the member only after leaving Edit mode: the space permission change
  # notifies the owner too, and its read-only re-probe drops Edit mode.
  Scenario: A foreign widget save is undone before the older dashboard layout edit
    When I choose "move-left" in the "Tasks Grid" widget menu
    And I click the dashboard Done button
    And I wait for the dashboard and widget conditions to reach the server
    And a workspace member with "read-only" access to the dashboard space
    And the member opens the dashboard
    Then dashboard row 1 holds "Tasks Grid, Projects Grid"
    And the member sees the "Tasks Grid" widget rows "Write launch plan, Review, Ship"
    When I add a "Stage" is "Done" filter inside the "Tasks Grid" widget
    Then the "Tasks Grid" widget shows the rows "Ship"
    And the "Tasks Grid" view has 0 saved filters
    And the member sees the "Tasks Grid" widget rows "Write launch plan, Review, Ship"
    When I save the global filters for everybody
    Then no global filter shows the local changes badge
    And the "Tasks Grid" view has 1 saved filters
    And the member sees the "Tasks Grid" widget rows "Ship"
    When I press undo without changing the dashboard focus
    Then the "Tasks Grid" view has 0 saved filters
    And the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"
    And the member sees the "Tasks Grid" widget rows "Write launch plan, Review, Ship"
    And dashboard row 1 holds "Tasks Grid, Projects Grid"
    When I press undo without changing the dashboard focus
    Then dashboard row 1 holds "Projects Grid, Tasks Grid"
    When I press redo without changing the dashboard focus
    Then dashboard row 1 holds "Tasks Grid, Projects Grid"
    And the "Tasks Grid" view has 0 saved filters
    When I press redo without changing the dashboard focus
    Then the "Tasks Grid" view has 1 saved filters
    And the "Tasks Grid" widget shows the rows "Ship"
    And the member sees the "Tasks Grid" widget rows "Ship"
    When I wait for the dashboard and widget conditions to reach the server
    And I reload the dashboard
    Then dashboard row 1 holds "Tasks Grid, Projects Grid"
    And the "Tasks Grid" widget shows the rows "Ship"

  Scenario: Global and widget filters across databases are saved as one undo action
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    When I reload the dashboard
    And I also select "Done" in the "Status" global filter
    And I add a "Status" is "Done" filter inside the "Projects Grid" widget
    And I add a "Stage" is "Done" filter inside the "Tasks Grid" widget
    Then the saved "Status" filter still matches only "Doing"
    And the "Projects Grid" view has 0 saved filters
    And the "Tasks Grid" view has 0 saved filters
    When I save the global filters for everybody
    Then no global filter shows the local changes badge
    And the saved "Status" filter matches "Doing, Done"
    And the "Projects Grid" view has 1 saved filters
    And the "Tasks Grid" view has 1 saved filters
    And the "Projects Grid" widget shows the rows "API cleanup"
    And the "Tasks Grid" widget shows the rows "Ship"
    When I press undo without changing the dashboard focus
    Then the saved "Status" filter matches "Doing"
    And the "Projects Grid" view has 0 saved filters
    And the "Tasks Grid" view has 0 saved filters
    And the "Projects Grid" widget shows the rows "Website launch"
    And the "Tasks Grid" widget shows the rows "Write launch plan"
    When I press redo without changing the dashboard focus
    Then the saved "Status" filter matches "Doing, Done"
    And the "Projects Grid" view has 1 saved filters
    And the "Tasks Grid" view has 1 saved filters
    And the "Projects Grid" widget shows the rows "API cleanup"
    And the "Tasks Grid" widget shows the rows "Ship"
    When I wait for the dashboard and widget conditions to reach the server
    And I reload the dashboard
    Then the saved "Status" filter matches "Doing, Done"
    And the "Projects Grid" widget shows the rows "API cleanup"
    And the "Tasks Grid" widget shows the rows "Ship"

  Scenario: Undoing a saved foreign filter preserves a collaborator's newer shared sort
    When I click the dashboard Done button
    And I wait for the dashboard and widget conditions to reach the server
    And a workspace member with "read-and-write" access to the dashboard space
    And the member opens the dashboard
    And I add a "Stage" is "Done" filter inside the "Tasks Grid" widget
    And I save the global filters for everybody
    Then the member sees the "Tasks Grid" widget rows "Ship"
    When the collaborator sets a shared descending "Points" sort in the "Tasks Grid" widget
    Then the "Tasks Grid" view has a saved "descending" sort by "Points"
    And the "Tasks Grid" view has 1 saved filters
    When I press undo without changing the dashboard focus
    Then the "Tasks Grid" view has 0 saved filters
    And the "Tasks Grid" view has a saved "descending" sort by "Points"
    And the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the member sees the "Tasks Grid" widget rows in order "Ship, Write launch plan, Review"
    When I press redo without changing the dashboard focus
    Then the "Tasks Grid" view has 1 saved filters
    And the "Tasks Grid" view has a saved "descending" sort by "Points"
    And the "Tasks Grid" widget shows rows in order "Ship"
    And the member sees the "Tasks Grid" widget rows in order "Ship"
    When I wait for the dashboard and widget conditions to reach the server
    And I reload the dashboard
    Then the "Tasks Grid" view has a saved "descending" sort by "Points"
    And the "Tasks Grid" widget shows the rows "Ship"
