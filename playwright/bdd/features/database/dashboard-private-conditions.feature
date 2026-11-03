@dashboard @cloud
Feature: Private dashboard sorts and resetting conditions
  Viewers can experiment with widget sorting and filters without changing the
  shared views; this device keeps them until they are saved or reset. Save for
  everyone publishes the conditions, while Reset restores all shared
  conditions together.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |

  Scenario: A foreign widget sort stays private after a reload
    When I reload the dashboard
    Then the "Tasks Grid" widget shows rows in order "Write launch plan, Review, Ship"
    When I sort the "Tasks Grid" widget by "Points" "descending"
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the dashboard shows unsaved changes
    And the "Tasks Grid" view has 0 saved sorts
    And the "Tasks Grid" view has 0 saved filters
    When I reload the dashboard
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the "Tasks Grid" widget Sort button shows an unsaved dot
    And the "Tasks Grid" view has 0 saved sorts

  Scenario: Save for everyone publishes a foreign widget sort to another viewer
    Given a workspace member with "read-only" access to the dashboard space
    When I reload the dashboard
    And the member opens the dashboard
    And I sort the "Tasks Grid" widget by "Points" "descending"
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the member sees the "Tasks Grid" widget rows in order "Write launch plan, Review, Ship"
    And the "Tasks Grid" view has 0 saved sorts
    When I click "Save for everyone" in the filter bar
    Then no unsaved dot is shown on the dashboard
    And the "Tasks Grid" view has a saved "descending" sort by "Points"
    And the member sees the "Tasks Grid" widget rows in order "Ship, Write launch plan, Review"
    When I wait for the dashboard and widget conditions to reach the server
    And I reload the dashboard
    Then the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the "Tasks Grid" view has a saved "descending" sort by "Points"

  Scenario: Reset restores shared global filters and discards widget filters and sorts together
    Given the dashboard has a saved "Status" filter for "Doing, Done" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And I reload the dashboard
    And I remember the shared dashboard and widget conditions
    When I also select "Todo" in the "Status" global filter
    And I add a "Status" is "Done" filter inside the "Projects Grid" widget
    And I sort the "Tasks Grid" widget by "Points" "descending"
    Then the "Projects Grid" widget shows rows in order "API cleanup"
    And the "Tasks Grid" widget shows rows in order "Ship, Write launch plan, Review"
    And the dashboard shows unsaved changes
    And the shared dashboard and widget conditions are unchanged
    When I reset the dashboard local conditions
    Then the "Projects Grid" widget shows rows in order "Website launch, API cleanup"
    And the "Tasks Grid" widget shows rows in order "Write launch plan, Ship"
    And the "Tasks Grid" widget has no active sort
    And no unsaved dot is shown on the dashboard
    And the shared dashboard and widget conditions are unchanged
    When I reload the dashboard
    Then the "Projects Grid" widget shows rows in order "Website launch, API cleanup"
    And the "Tasks Grid" widget shows rows in order "Write launch plan, Ship"
    And the shared dashboard and widget conditions are unchanged

  Scenario: A read-only member can sort and reset a widget without saving
    Given a workspace member with "read-only" access to the dashboard space
    And I remember the shared dashboard and widget conditions
    When the member opens the dashboard
    And the member sorts the "Tasks Grid" widget by "Points" "descending"
    Then the member sees the "Tasks Grid" widget rows in order "Ship, Write launch plan, Review"
    And the member sees "Reset" but no "Save for everyone" in the filter bar
    And the "Tasks Grid" widget shows rows in order "Write launch plan, Review, Ship"
    And the shared dashboard and widget conditions are unchanged
    When the member resets the dashboard local conditions
    Then the member sees the "Tasks Grid" widget rows in order "Write launch plan, Review, Ship"
    And the shared dashboard and widget conditions are unchanged
