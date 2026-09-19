@dashboard @dashboard-usecase @cloud
Feature: Personal daily planner
  Based on the "Homepage – Dashboard" planner in Notion's dashboard
  collection: lists for today, overdue and someday tasks, a progress donut
  and a calendar, all on one Tasks database. Its owner plans and closes out
  the day from the dashboard.

  Background:
    Given a workspace for the "Daily planner" use case
    And a "My tasks" database with these properties:
      | property | type   | options                   |
      | Status   | Select | To do, In progress, Done  |
      | Urgency  | Select | Urgent, Normal, Someday   |
      | Due      | Date   |                           |
    And "My tasks" has these rows:
      | Name            | Status      | Urgency | Due       |
      | Pay rent        | To do       | Urgent  | today     |
      | Book dentist    | To do       | Normal  | today - 2 |
      | Write blog post | In progress | Normal  | today + 3 |
      | Learn Spanish   | To do       | Someday |           |
      | Plan trip       | To do       | Someday |           |
      | Submit report   | Done        | Urgent  | today     |
    And "My tasks" has these views:
      | view     | layout      | settings                                              |
      | Today    | List        | where Due is today and Status is not Done              |
      | Overdue  | List        | where Due is before today and Status is not Done       |
      | Someday  | List        | where Due is empty                                     |
      | Progress | Donut chart | count by Status                                        |
      | Calendar | Calendar    | by Due                                                 |
    And the "Home" dashboard on "My tasks" shows:
      | row | widgets                  |
      | 1   | Today, Overdue, Someday  |
      | 2   | Progress, Calendar       |

  Scenario: Morning review
    When I open the "Home" dashboard
    Then the "Today" widget lists "Pay rent"
    And the "Overdue" widget lists "Book dentist"
    And the "Someday" widget lists "Learn Spanish, Plan trip"
    And the "Progress" chart total is "6"
    And the "Calendar" widget shows "Pay rent" on today

  Scenario: Scheduling a someday task for today
    When I open the "Home" dashboard
    And I open the "Plan trip" row from the "Someday" widget
    And I set "Due" to "today" on the open page
    And I close the row page
    Then the "Someday" widget lists "Learn Spanish"
    And the "Today" widget lists "Pay rent, Plan trip"

  Scenario: Finishing a task clears it from today
    When I open the "Home" dashboard
    And I open the "Pay rent" row from the "Today" widget
    And I set "Status" to "Done" on the open page
    And I close the row page
    Then the "Today" widget lists nothing
    When I click the "Done" segment of the "Progress" chart
    Then the drill-down lists "Pay rent, Submit report"

  Scenario: Catching up on an overdue task
    When I open the "Home" dashboard
    And I open the "Book dentist" row from the "Overdue" widget
    And I set "Due" to "today" on the open page
    And I close the row page
    Then the "Overdue" widget lists nothing
    And the "Today" widget lists "Pay rent, Book dentist"
