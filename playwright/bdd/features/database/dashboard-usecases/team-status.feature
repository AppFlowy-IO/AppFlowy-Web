@dashboard @dashboard-usecase @cloud
Feature: Weekly team status hub across two databases
  Based on Notion's official "Projects & Tasks" dashboard (active projects,
  status breakdown, roadmap timeline, tasks per person) and the help centre's
  "Team status hub" layout. The project manager assembles it from the
  Projects and Tasks databases and the team uses it at stand-up.

  Background:
    Given a workspace for the "Team status" use case
    And a "Projects" database with these properties:
      | property | type   | options                            |
      | Status   | Select | Planning, In progress, Paused, Done |
      | Owner    | Select | Maya, Leo, Sam                     |
      | Start    | Date   |                                    |
      | End      | Date   |                                    |
    And "Projects" has these rows:
      | Name               | Status      | Owner | Start      | End        |
      | Research study     | In progress | Maya  | today - 10 | today + 20 |
      | Marketing campaign | In progress | Leo   | today - 5  | today + 10 |
      | Website redesign   | Planning    | Maya  | today + 3  | today + 30 |
      | Product launch     | In progress | Leo   | today - 2  | today + 40 |
      | Legacy cleanup     | Done        | Leo   | today - 30 | today - 5  |
    And a "Tasks" database with these properties:
      | property | type   | options                        |
      | Status   | Select | Not started, In progress, Done |
      | Assignee | Select | Maya, Leo, Sam                 |
      | Due      | Date   |                                |
    And "Tasks" has these rows:
      | Name                 | Status      | Assignee | Due        |
      | Draft survey         | In progress | Maya     | today + 1  |
      | Recruit participants | Not started | Maya     | today + 4  |
      | Write ad copy        | In progress | Leo      | today      |
      | Book launch venue    | Not started | Leo      | today + 6  |
      | Update pricing page  | Done        | Leo      | today - 1  |
      | Design hero section  | Not started | Sam      | today + 8  |
      | QA checklist         | In progress | Sam      | today + 2  |
      | Analyze results      | Not started | Maya     | today + 14 |
    And "Projects" has these views:
      | view             | layout      | settings                     |
      | Active projects  | Grid        | where Status is In progress  |
      | Status breakdown | Donut chart | count by Status              |
      | Roadmap          | Timeline    | from Start to End            |
    And "Tasks" has these views:
      | view             | layout    | settings           |
      | Tasks per person | Bar chart | count by Assignee  |

  Scenario: The project manager assembles the hub from two databases
    When I create a dashboard named "Weekly status" on "Projects"
    And I add the "Active projects" view as a widget
    And I add the "Status breakdown" view as a widget next to "Active projects"
    And I add the "Roadmap" view as a widget on a new row
    And I search for "Tasks" and add the "Tasks per person" view as a widget next to "Roadmap"
    And I resize "Active projects" to 8 columns
    And I finish editing the dashboard
    Then the dashboard shows these rows:
      | row | widgets                           |
      | 1   | Active projects, Status breakdown |
      | 2   | Roadmap, Tasks per person         |
    And the widths of dashboard row 1 are "8, 4"
    And the "Active projects" widget lists "Research study, Marketing campaign, Product launch"
    And the "Status breakdown" chart total is "5"
    And the "Roadmap" timeline shows the bars "Research study, Marketing campaign, Website redesign, Product launch, Legacy cleanup"
    And the "Tasks per person" chart shows these values:
      | label | value |
      | Maya  | 3     |
      | Leo   | 3     |
      | Sam   | 2     |
    When I reload the dashboard
    Then the widths of dashboard row 1 are "8, 4"

  Scenario: Kicking off a project from the roadmap updates the hub
    Given the "Weekly status" dashboard on "Projects" shows:
      | row | widgets                           |
      | 1   | Active projects, Status breakdown |
      | 2   | Roadmap, Tasks per person         |
    When I open the "Website redesign" row from the "Roadmap" widget
    And I set "Status" to "In progress" on the open page
    And I close the row page
    Then the "Active projects" widget lists "Research study, Marketing campaign, Website redesign, Product launch"
    When I click the "In progress" segment of the "Status breakdown" chart
    Then the drill-down lists "Research study, Marketing campaign, Website redesign, Product launch"

  Scenario: Stand-up with one teammate's work across both databases
    Given the "Weekly status" dashboard on "Projects" shows:
      | row | widgets                           |
      | 1   | Active projects, Status breakdown |
      | 2   | Roadmap, Tasks per person         |
    When I add a global filter where "Owner" is "Maya", using "Assignee" in "Tasks"
    Then the "Owner" global filter chip shows 2 sources
    And the "Active projects" widget lists "Research study"
    And the "Status breakdown" chart total is "2"
    And the "Tasks per person" chart shows these values:
      | label | value |
      | Maya  | 3     |

  Scenario: A teammate follows the hub but cannot rearrange it
    Given the "Weekly status" dashboard on "Projects" shows:
      | row | widgets                           |
      | 1   | Active projects, Status breakdown |
      | 2   | Roadmap, Tasks per person         |
    And a teammate who can only view the "Team status" space
    When the teammate opens the "Weekly status" dashboard
    Then the teammate sees the dashboard in View mode without an Edit button
    And the teammate sees the "Active projects" widget list "Research study, Marketing campaign, Product launch"
    When the teammate adds a global filter where "Owner" is "Leo"
    Then the teammate sees the "Active projects" widget list "Marketing campaign, Product launch"
    And the teammate sees that the global filter only applies for them
    And the "Active projects" widget lists "Research study, Marketing campaign, Product launch"
