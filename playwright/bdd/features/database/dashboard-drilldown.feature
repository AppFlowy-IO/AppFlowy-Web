@dashboard @dashboard-usecase @cloud
Feature: Chart drill-down and record side peek
  Clicking a bar, slice or number opens a live table of the matching pages,
  with the widget's filters as chips, search, and a menu to save the result
  as a view. Records opened from a dashboard open in a side peek by default.

  Background:
    Given a workspace for the "Bug triage" use case
    And a "Bug Tracker" database with these properties:
      | property  | type   | options                         |
      | Status    | Select | New, In progress, Resolved      |
      | Severity  | Select | Blocker, Major, Minor, Trivial  |
      | Component | Select | API, Frontend, Mobile           |
      | Assignee  | Select | Dana, Eli                       |
      | Due       | Date   |                                 |
    And "Bug Tracker" has these rows:
      | Name                       | Status      | Severity | Component | Assignee | Due        |
      | Login fails on Safari      | New         | Blocker  | Frontend  |          | today - 1  |
      | Crash on photo upload      | In progress | Blocker  | Mobile    | Eli      | today + 2  |
      | Slow search results        | In progress | Major    | API       | Dana     | today - 3  |
      | Typo on pricing page       | New         | Trivial  | Frontend  |          | today + 7  |
      | Push notifications delayed | New         | Major    | Mobile    | Eli      | today + 1  |
      | Export times out           | Resolved    | Major    | API       | Dana     | today - 5  |
      | Dark mode contrast         | Resolved    | Minor    | Frontend  | Dana     | today - 2  |
      | Token refresh race         | New         | Minor    | API       |          | today      |
    And "Bug Tracker" has these views:
      | view          | layout       | settings                                                   |
      | Open bugs     | Number chart | count where Status is not Resolved                         |
      | In progress   | Number chart | count where Status is In progress                          |
      | Overdue       | Number chart | count where Due is before today and Status is not Resolved |
      | By severity   | Donut chart  | count by Severity where Status is not Resolved             |
      | By status     | Bar chart    | count by Status                                            |
      | High priority | Grid         | where Severity is Blocker and Status is not Resolved       |
      | Unassigned    | Grid         | where Assignee is empty and Status is not Resolved         |
    And the "Triage" dashboard on "Bug Tracker" shows:
      | row | widgets                             |
      | 1   | Open bugs, In progress, Overdue     |
      | 2   | By severity, By status              |
      | 3   | High priority, Unassigned           |

  Scenario: Clicking a chart segment opens a table of the matching rows
    When I open the "Triage" dashboard
    And I click the "Blocker" segment of the "By severity" chart
    Then the drill-down is titled "Blocker"
    And the drill-down shows the row count "2 rows"
    And the drill-down shows the columns "Name, Status, Severity, Component, Assignee, Due"
    And the drill-down lists "Login fails on Safari, Crash on photo upload"
    And the drill-down shows the category chip "Severity: Blocker"
    And the drill-down shows an editable filter chip for "Status"

  Scenario: Searching narrows the drill-down
    When I open the "Triage" dashboard
    And I click the "New" segment of the "By status" chart
    Then the drill-down lists "Login fails on Safari, Typo on pricing page, Push notifications delayed, Token refresh race"
    When I search the drill-down for "token"
    Then the drill-down lists "Token refresh race"
    When I clear the drill-down search
    Then the drill-down shows the row count "4 rows"

  Scenario: A filter added in the drill-down stays in the drill-down
    When I open the "Triage" dashboard
    And I click the "New" segment of the "By status" chart
    And I add a "Component" is "Frontend" filter in the drill-down
    Then the drill-down lists "Login fails on Safari, Typo on pricing page"
    And the "By status" view has 0 saved filters
    When I close the drill-down
    And I click the "New" segment of the "By status" chart
    Then the drill-down shows the row count "4 rows"

  Scenario: Dashboard filters apply to the drill-down as read-only chips
    When I open the "Triage" dashboard
    And I add a global filter where "Component" is "Mobile"
    And I click the "Blocker" segment of the "By severity" chart
    Then the drill-down lists "Crash on photo upload"
    And the drill-down shows the dashboard filter chip "Component: Mobile"
    And the dashboard filter chip "Component: Mobile" in the drill-down cannot be edited

  Scenario: The drill-down stays live while a record is edited in a side peek
    When I open the "Triage" dashboard
    And I click the "Blocker" segment of the "By severity" chart
    And I open "Crash on photo upload" from the drill-down
    Then "Crash on photo upload" opens in a side peek
    When I set "Status" to "Resolved" on the open page
    And I close the side peek
    Then the drill-down lists "Login fails on Safari"
    And the drill-down shows the row count "1 row"

  Scenario: Clicking a number tile lists the counted rows
    When I open the "Triage" dashboard
    And I click the number of the "Overdue" widget
    Then the drill-down lists "Login fails on Safari, Slow search results"
    And the drill-down shows no category chip

  Scenario: Save as view creates a filtered table in the source database
    When I open the "Triage" dashboard
    And I click the "Blocker" segment of the "By severity" chart
    And I choose "Save as view…" in the drill-down menu
    Then the view name field shows "Blocker"
    When I save the view as "Open blockers"
    Then the "Open blockers" view of "Bug Tracker" is open
    And the "Open blockers" view is a table listing "Login fails on Safari, Crash on photo upload"
    And the "Open blockers" view has 2 saved filters
    And the "Open blockers" view is shown as a tab of "Bug Tracker"

  Scenario: The drill-down menu opens the source database
    When I open the "Triage" dashboard
    And I click the "Blocker" segment of the "By severity" chart
    And I choose "Open Bug Tracker" in the drill-down menu
    Then the "Bug Tracker" database page is open

  Scenario: Records open in a side peek from a dashboard widget
    When I open the "Triage" dashboard
    And I open the "Crash on photo upload" row from the "High priority" widget
    Then "Crash on photo upload" opens in a side peek
    And the side peek has its default width
    When I press Escape
    Then no side peek is open
    And the dashboard is still open

  Scenario: The side peek expands to a full page
    When I open the "Triage" dashboard
    And I open the "Crash on photo upload" row from the "High priority" widget
    And I click "Open as full page" in the side peek
    Then the row page for "Crash on photo upload" is open as a full page

  Scenario: "Open pages in" switches a widget to center peek
    When I open the "Triage" dashboard
    And I switch the dashboard to Edit mode
    And I set "Open pages in" to "Center peek" for the "High priority" widget
    And I finish editing the dashboard
    And I open the "Crash on photo upload" row from the "High priority" widget
    Then "Crash on photo upload" opens in a center peek
    And the "High priority" view opens pages in "center_peek"

  @wp12
  Scenario: Clicking a stacked segment filters by both groups
    Given the "By status" chart is grouped by "Severity"
    When I open the "Triage" dashboard
    And I click the "Blocker" part of the "New" bar in the "By status" chart
    Then the drill-down lists "Login fails on Safari"
    And the drill-down shows the category chips "Status: New, Severity: Blocker"
