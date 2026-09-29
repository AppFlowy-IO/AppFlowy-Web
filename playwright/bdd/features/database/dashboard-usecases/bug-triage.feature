@dashboard @dashboard-usecase @cloud
Feature: Bug triage dashboard
  Based on the "Bug Tracker Dashboard" that Notion Agent builds in Notion's
  help video (KPI tiles Open bugs / In progress / Overdue, breakdowns by
  status and severity, tables of high-priority and unassigned bugs) and the
  help centre's "ticket or incident overview" layout. The on-call engineer
  triages from the dashboard during the day.

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

  Scenario: The on-call engineer reads the state of the queue at a glance
    When I open the "Triage" dashboard
    Then the dashboard opens in View mode
    And the "Open bugs" widget shows the number "6"
    And the "In progress" widget shows the number "2"
    And the "Overdue" widget shows the number "2"
    And the "By severity" chart total is "6"
    And the "By status" chart shows these values:
      | label       | value |
      | New         | 4     |
      | In progress | 2     |
      | Resolved    | 2     |
    And the "High priority" widget lists "Login fails on Safari, Crash on photo upload"
    And the "Unassigned" widget lists "Login fails on Safari, Typo on pricing page, Token refresh race"

  Scenario: Resolving a blocker from the table updates every tile
    When I open the "Triage" dashboard
    And I change the "Status" of "Login fails on Safari" to "Resolved" in the "High priority" widget
    Then the "High priority" widget lists "Crash on photo upload"
    And the "Open bugs" widget shows the number "5"
    And the "Overdue" widget shows the number "1"
    And the "By severity" chart total is "5"
    And the "By status" chart shows these values:
      | label       | value |
      | New         | 3     |
      | In progress | 2     |
      | Resolved    | 3     |
    And the "Unassigned" widget lists "Typo on pricing page, Token refresh race"

  Scenario: Assigning a bug takes it off the unassigned list
    When I open the "Triage" dashboard
    And I change the "Assignee" of "Typo on pricing page" to "Dana" in the "Unassigned" widget
    Then the "Unassigned" widget lists "Login fails on Safari, Token refresh race"
    And the "Assignee" of "Typo on pricing page" in "Bug Tracker" is "Dana"

  Scenario: Drilling into the blockers from the severity chart
    When I open the "Triage" dashboard
    And I click the "Blocker" segment of the "By severity" chart
    Then the drill-down lists "Login fails on Safari, Crash on photo upload"
    When I open "Crash on photo upload" from the drill-down
    Then the row page for "Crash on photo upload" is open

  Scenario: Focusing the whole dashboard on the mobile app
    When I open the "Triage" dashboard
    And I add a global filter where "Component" is "Mobile"
    Then the "Open bugs" widget shows the number "2"
    And the "In progress" widget shows the number "1"
    And the "Overdue" widget shows that there are no rows to count
    And the "High priority" widget lists "Crash on photo upload"
    And the "Unassigned" widget lists nothing

  Scenario: Reporting a new bug straight from the unassigned table
    When I open the "Triage" dashboard
    And I add a row named "Checkout button misaligned" in the "Unassigned" widget
    Then the "Unassigned" widget lists "Login fails on Safari, Typo on pricing page, Token refresh race, Checkout button misaligned"
    And the "Open bugs" widget shows the number "7"
