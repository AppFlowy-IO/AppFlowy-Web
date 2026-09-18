@dashboard @cloud
Feature: Dashboard View and Edit modes
  Everyone sees a dashboard in View mode. Users who can write toggle Edit mode
  with the Edit / Done button; the mode is local UI state and is never saved.
  In View mode a global-filter change only affects the current viewer until
  someone with write access saves it for everybody.

  Background:
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |

  Scenario: A View-mode widget filter is local until reload
    When I reload the dashboard
    And I add a "Status" is "Done" filter inside the "Projects Grid" widget
    Then I see the "Projects Grid" widget with 1 rows
    And the dashboard shows the local changes badge
    And the "Projects Grid" view has 0 saved filters
    When I reload the dashboard
    Then I see the "Projects Grid" widget with 3 rows

  Scenario: Save for everybody persists a View-mode widget filter
    When I reload the dashboard
    And I add a "Status" is "Done" filter inside the "Projects Grid" widget
    And I save the global filters for everybody
    Then no global filter shows the local changes badge
    And the "Projects Grid" view has 1 saved filters
    When I wait for the dashboard layout to reach the server
    And I reload the dashboard
    Then I see the "Projects Grid" widget with 1 rows

  Scenario: A read-only member can filter a widget locally
    Given a workspace member with "read-only" access to the dashboard space
    When the member opens the dashboard
    And the member adds a "Status" is "Done" filter inside the "Projects Grid" widget
    Then the member sees the local changes badge without a Save for everybody button
    And the member sees the "Projects Grid" widget with 1 rows
    And the "Projects Grid" view has 0 saved filters

  Scenario: A dashboard opens in View mode
    When I reload the dashboard
    Then the dashboard is in View mode
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"

  Scenario: Edit and Done toggle the editing controls without saving the mode
    When I click the dashboard Done button
    Then the dashboard is in View mode
    When I click the dashboard Edit button
    Then the dashboard is in Edit mode
    And the dashboard shows width handles
    When I reload the dashboard
    Then the dashboard is in View mode

  Scenario: A read-only member does not get the Edit button
    Given a workspace member with "read-only" access to the dashboard space
    When the member opens the dashboard
    Then the member sees the dashboard in View mode without the Edit button
    And the member sees the "Projects Grid" widget with 3 rows

  Scenario: A View-mode global filter change is local until reload
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And I reload the dashboard
    Then the "Projects Grid" widget shows the rows "Website launch"
    When I also select "Done" in the "Status" global filter
    Then the "Status" global filter shows the local changes badge
    And the "Projects Grid" widget shows the rows "Website launch, API cleanup"
    And the saved "Status" filter still matches only "Doing"
    When I reload the dashboard
    Then no global filter shows the local changes badge
    And the "Projects Grid" widget shows the rows "Website launch"

  Scenario: Save for everybody persists a View-mode filter change
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And I reload the dashboard
    When I also select "Done" in the "Status" global filter
    And I save the global filters for everybody
    Then no global filter shows the local changes badge
    And the saved "Status" filter matches "Doing, Done"
    When I wait for the dashboard layout to reach the server
    And I reload the dashboard
    Then the "Projects Grid" widget shows the rows "Website launch, API cleanup"
    And the "Tasks Grid" widget shows the rows "Write launch plan, Ship"

  Scenario: A read-only member can filter locally but cannot save for everybody
    Given the dashboard has a saved "Status" filter for "Doing" mapped to "Status" in "Projects" and "Stage" in "Tasks"
    And a workspace member with "read-only" access to the dashboard space
    When the member opens the dashboard
    And the member also selects "Done" in the "Status" global filter
    Then the member sees the local changes badge without a Save for everybody button
    And the member sees the "Projects Grid" widget with 2 rows
    And the saved "Status" filter still matches only "Doing"
