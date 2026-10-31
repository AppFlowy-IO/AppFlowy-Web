@dashboard @dashboard-usecase @dashboard-template-2 @cloud @product-roadmap
Feature: Product launch roadmap dashboard
  Based on the Help Centre's "Acme > H1 Overview" portfolio dashboard: a
  26H1 launches line, a project overview donut, projects by priority, an H1
  timeline widget with a Today navigator and a staff-review list with
  "Needs review" and "Pending" pills. The PMO lead runs the weekly roadmap
  review from it: drills into the launches in flight, drags a slipping
  launch on the timeline, narrows the page to a date window, looks for
  overdue and unscheduled launches, and keeps a second, smaller dashboard
  for executives.

  # "Launch runway" groups launch dates relative to today: Yesterday (-1),
  # Tomorrow (+1), the 2-7 and 8-30 day buckets on each side, then calendar
  # months for anything further away ("month of today + 45" is resolved to
  # the label the chart prints, "Nov 2026"). The far launches sit 45 or more
  # days apart, so each has its own month. A run that crosses midnight
  # between seeding and checking can move a launch into the next bucket.

  Background:
    Given a workspace for the "Product roadmap" use case
    And a "Launches" database with these properties:
      | property | type   | options                         |
      | Status   | Select | Planned, Building, Launched     |
      | Priority | Select | P0, P1, P2                      |
      | Review   | Select | Needs review, Pending, Approved |
      | Team     | Select | Platform, Growth, Mobile        |
      | Start    | Date   |                                 |
      | Launch   | Date   |                                 |
    And "Launches" has these rows:
      | Name                   | Status   | Priority | Review       | Team     | Start      | Launch     |
      | Primitive architecture | Building | P0       | Needs review | Platform | today - 30 | today + 10 |
      | Explore entry paths    | Building | P1       | Pending      | Growth   | today - 20 | today + 5  |
      | Offline mode           | Planned  | P0       | Needs review | Mobile   | today + 5  | today + 90 |
      | Referral program       | Launched | P1       | Approved     | Growth   | today - 60 | today - 10 |
      | Usage-based billing    | Building | P0       | Pending      | Platform | today - 15 | today - 1  |
      | Widget gallery         | Planned  | P2       | Approved     | Mobile   | today + 20 | today + 45 |
      | Admin audit log        | Planned  | P2       | Pending      | Platform |            |            |
      | Dark mode              | Launched | P1       | Approved     | Mobile   | today - 90 | today - 40 |
      | Status page revamp     | Building | P2       | Needs review | Growth   | today - 6  | today + 1  |
      | SOC 2 evidence export  | Launched | P2       | Approved     | Platform | today - 25 | today - 3  |
    And "Launches" has these views:
      | view          | layout      | settings                              |
      | Launch runway | Line chart  | count by Launch per relative date     |
      | Portfolio     | Donut chart | count by Status                       |
      | By priority   | Bar chart   | count by Priority                     |
      | H1 timeline   | Timeline    | from Start to Launch                  |
      | Staff review  | List        | where Review is Needs review, Pending |
      | Unscheduled   | List        | where Launch is empty                 |
    And the "Overview" dashboard on "Launches" shows:
      | row | widgets                               |
      | 1   | Launch runway, Portfolio, By priority |
      | 2   | H1 timeline, Staff review             |
      | 3   | Unscheduled                           |

  Scenario: The weekly roadmap review
    When I open the "Overview" dashboard
    Then the "H1 timeline" timeline shows the bars "Primitive architecture, Explore entry paths, Offline mode, Referral program, Usage-based billing, Widget gallery, Dark mode, Status page revamp, SOC 2 evidence export"
    And the "Portfolio" chart total is "10"
    And the "By priority" chart shows these values:
      | label | value |
      | P0    | 3     |
      | P1    | 3     |
      | P2    | 4     |
    And the "Launch runway" chart shows these values:
      | label               | value |
      | Last 30 days        | 1     |
      | Last 7 days         | 1     |
      | Yesterday           | 1     |
      | Tomorrow            | 1     |
      | Next 7 days         | 1     |
      | Next 30 days        | 1     |
      | month of today - 40 | 1     |
      | month of today + 45 | 1     |
      | month of today + 90 | 1     |
      | No Launch           | 1     |
    And the "Staff review" widget lists "Primitive architecture, Explore entry paths, Offline mode, Usage-based billing, Admin audit log, Status page revamp"
    And the "Unscheduled" widget lists "Admin audit log"
    When I click the "Building" segment of the "Portfolio" chart
    Then the drill-down shows the row count "4 rows"
    And the drill-down lists "Primitive architecture, Explore entry paths, Usage-based billing, Status page revamp"
    When I close the drill-down
    And I open the "Usage-based billing" row from the "H1 timeline" widget
    Then the row page for "Usage-based billing" is open

  Scenario: A slipping launch is dragged a week later on the timeline
    When I open the "Overview" dashboard
    And I drag the "Explore entry paths" bar 7 days later in the "H1 timeline" widget
    Then the "Launch" date of "Explore entry paths" in "Launches" is "today + 12"
    And the "Start" date of "Explore entry paths" in "Launches" is "today - 13"
    And the "Launch runway" chart shows these values:
      | label               | value |
      | Last 30 days        | 1     |
      | Last 7 days         | 1     |
      | Yesterday           | 1     |
      | Tomorrow            | 1     |
      | Next 30 days        | 2     |
      | month of today - 40 | 1     |
      | month of today + 45 | 1     |
      | month of today + 90 | 1     |
      | No Launch           | 1     |

  Scenario: Narrowing the review to a date window, to overdue launches and to unscheduled work
    When I open the "Overview" dashboard
    And I add a global filter on "Launch" with the condition "Is between" and the value "today - 14 to today + 14"
    Then the "H1 timeline" timeline shows the bars "Primitive architecture, Explore entry paths, Referral program, Usage-based billing, Status page revamp, SOC 2 evidence export"
    And the "Staff review" widget lists "Primitive architecture, Explore entry paths, Usage-based billing, Status page revamp"
    And the "Unscheduled" widget lists nothing
    And the "Portfolio" chart total is "6"
    And the "By priority" chart shows these values:
      | label | value |
      | P0    | 2     |
      | P1    | 2     |
      | P2    | 2     |
    When I remove the global filter "Launch"
    And I add a global filter on "Launch" with the condition "Is before" and the value "today"
    Then the "H1 timeline" timeline shows the bars "Referral program, Usage-based billing, Dark mode, SOC 2 evidence export"
    And the "Staff review" widget lists "Usage-based billing"
    And the "Portfolio" chart total is "4"
    When I remove the global filter "Launch"
    And I add a global filter on "Launch" with the condition "Is empty" and the value ""
    Then the "H1 timeline" timeline shows no bars
    And the "Staff review" widget lists "Admin audit log"
    And the "Portfolio" chart total is "1"

  Scenario: Dashboards never nest inside each other
    Given the "Exec summary" dashboard on "Launches" shows:
      | row | widgets                |
      | 1   | Portfolio, By priority |
    When I open the "Overview" dashboard
    And I switch the dashboard to Edit mode
    # "+" inserts a Count all Number widget and opens the picker beside it.
    And I open the widget picker
    Then the widget picker does not offer the "Exec summary" view
    And the widget picker does not offer the "Overview" view
    When the user closes the "New view" picker
    And I press the dashboard undo shortcut
    Then the dashboard shows 6 widgets
    When I finish editing the dashboard
    And I turn the "Staff review" view into a dashboard
    And I open the "Overview" dashboard
    Then the "Staff review" widget shows the "unsupported" placeholder saying "A dashboard can't be shown inside a dashboard"
    When I switch the dashboard to Edit mode
    And I remove the "Staff review" widget from its placeholder
    Then the dashboard shows 5 widgets
    And the "Portfolio" chart total is "10"
