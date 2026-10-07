@dashboard @dashboard-usecase @dashboard-template-2 @cloud @agency-hub
Feature: Agency operations hub across four databases
  Based on the agency overview Notion AI builds from four @-mentioned
  databases (clients, projects, tasks and documents as count tiles, status
  donuts, a tasks-due table), Workflow Lab's "Reporting" page (open tasks by
  assignee) and the "Your tasks" tab of the Notion dashboards team's hub.
  Every teammate uses a "my work" person filter across clients, projects
  and tasks; the owner learns which properties can share a filter or a
  chart axis, charts the open work by assignee, and finds the documents a
  colleague wrote.

  # People cells: "me" is the workspace owner running the scenario and
  # "the teammate" is the member the Background invites with edit access.
  # Clients gets its own select option ids (as a database made separately
  # would), so its "Active" option is not the Projects "Active" option; a
  # dashboard filter still matches the two by name.
  #
  # The filter menu lists properties by source and never offers Relation,
  # Rollup or Formula properties (they resolve per database). Charts group
  # their axis by any property but Formula, Rollup and AI ones, and show the
  # same properties as values.

  Background:
    Given a workspace for the "Agency" use case
    And a teammate who can edit the "Agency" space
    And a "Clients" database with these properties:
      | property        | type   | options         |
      | Status          | Select | Active, Churned |
      | Account manager | Person |                 |
      | Website         | URL    |                 |
    And the "Clients" select options have their own ids
    And "Clients" has these rows:
      | Name      | Status  | Account manager | Website              |
      | Northwind | Active  | me              | https://northwind.io |
      | Globex    | Active  | the teammate    | https://globex.com   |
      | Initech   | Churned | me              | https://initech.com  |
      | Umbrella  | Active  | the teammate    | https://umbrella.eu  |
    And a "Projects" database with these properties:
      | property | type     | options              |
      | Status   | Select   | Active, Paused, Done |
      | Lead     | Person   |                      |
      | Client   | Relation | Clients              |
      | Budget   | Number   | US dollar            |
      | Margin   | Formula  | prop("Budget") * 0.3 |
    And "Projects" has these rows:
      | Name                 | Status | Lead         | Client    | Budget |
      | Northwind rebrand    | Active | me           | Northwind | 40000  |
      | Globex app redesign  | Active | the teammate | Globex    | 65000  |
      | Initech SEO audit    | Done   | me           | Initech   | 12000  |
      | Umbrella launch site | Paused | the teammate | Umbrella  | 30000  |
      | Northwind newsletter | Active | the teammate | Northwind | 8000   |
    And a "Tasks" database with these properties:
      | property       | type     | options              |
      | Status         | Select   | To do, Doing, Done   |
      | Assignee       | Person   |                      |
      | Due            | Date     |                      |
      | Project        | Relation | Projects             |
      | Project budget | Rollup   | Project: Budget, sum |
    And "Tasks" has these rows:
      | Name                | Status | Assignee     | Due        | Project              |
      | Moodboard review    | Doing  | me           | today      | Northwind rebrand    |
      | Logo variations     | To do  | me           | today + 3  | Northwind rebrand    |
      | Wireframes v2       | Doing  | the teammate | today + 1  | Globex app redesign  |
      | Usability test      | To do  | the teammate | today + 10 | Globex app redesign  |
      | Final SEO report    | Done   | me           | today - 5  | Initech SEO audit    |
      | Hosting migration   | To do  | the teammate | today + 5  | Umbrella launch site |
      | Newsletter template | Doing  | the teammate | today + 2  | Northwind newsletter |
      | Invoice Globex      | To do  | me           | today - 1  | Globex app redesign  |
    And a "Documents" database with these properties:
      | property | type           | options                    |
      | Type     | Select         | Proposal, Contract, Report |
      | Author   | Created by     |                            |
      | Editor   | Last edited by |                            |
    And "Documents" has these rows:
      | Name               | Type     |
      | Northwind proposal | Proposal |
      | Globex contract    | Contract |
      | Q3 agency report   | Report   |
    And "Clients" has these views:
      | view           | layout       | settings                     |
      | Active clients | Number chart | count where Status is Active |
    And "Projects" has these views:
      | view               | layout       | settings                             |
      | Budget in play     | Number chart | sum of Budget where Status is Active |
      | Projects by status | Donut chart  | count by Status                      |
    And "Tasks" has these views:
      | view            | layout       | settings                                         |
      | Open tasks      | Number chart | count where Status is not Done                   |
      | Tasks by status | Bar chart    | count by Status                                  |
      | Due soon        | Grid         | sorted by Due ascending where Status is not Done |
    And "Documents" has these views:
      | view      | layout | settings |
      | Documents | List   |          |
    And the "Agency overview" dashboard on "Projects" shows:
      | row | widgets                                    |
      | 1   | Active clients, Budget in play, Open tasks |
      | 2   | Projects by status, Tasks by status        |
      | 3   | Due soon, Documents                        |

  Scenario: My work: one person filter across clients, projects and tasks
    # Three other databases feed the page: at most two load at a time.
    When I open the "Agency overview" dashboard with nothing cached
    Then no more than 2 source databases were loading at the same time
    And the "Active clients" widget shows the number "3"
    And the "Budget in play" widget shows the number "$113,000"
    And the "Open tasks" widget shows the number "7"
    And the "Due soon" widget lists in order "Invoice Globex, Moodboard review, Wireframes v2, Newsletter template, Logo variations, Hosting migration, Usability test"
    When I add a global filter on "Lead" with the condition "Contains" and the value "me", using:
      | property        | database |
      | Account manager | Clients  |
      | Assignee        | Tasks    |
    Then the "Lead" global filter chip shows 3 sources
    And the "Active clients" widget shows the number "1"
    And the "Budget in play" widget shows the number "$40,000"
    And the "Projects by status" chart total is "2"
    And the "Open tasks" widget shows the number "3"
    And the "Due soon" widget lists in order "Invoice Globex, Moodboard review, Logo variations"
    And the "Tasks by status" chart shows these values:
      | label | value |
      | To do | 2     |
      | Doing | 1     |
      | Done  | 1     |
    And the "Documents" widget lists "Northwind proposal, Globex contract, Q3 agency report"
    # Handing a task to a colleague drops it from my list.
    When I change the "Assignee" of "Logo variations" to "the teammate" in the "Due soon" widget
    Then the "Due soon" widget lists in order "Invoice Globex, Moodboard review"
    And the "Open tasks" widget shows the number "2"

  Scenario: What can and cannot share a filter
    When I open the "Agency overview" dashboard
    And I open the dashboard filter menu
    Then the filter menu does not list "Client" in "Projects"
    And the filter menu does not list "Margin" in "Projects"
    And the filter menu does not list "Project" in "Tasks"
    And the filter menu does not list "Project budget" in "Tasks"
    # Budget is the only Number property on the page: no other source can join it.
    When I choose "Filter multiple sources" in the filter menu
    And I click "Add to filter" in the filter menu
    And I pick the "Budget" property of "Projects" in the filter menu
    Then the multiple sources builder lists "Budget" from "Projects"
    And the multiple sources builder does not offer "Add another"
    When I close the global filter editor
    And I open the "Budget" global filter
    And I choose the "Is greater than" condition in the open global filter
    And I type "30000" into the open global filter
    And I close the global filter editor
    Then the "Budget" global filter pill has no source count badge
    And the "Budget in play" widget shows the number "$105,000"
    And the "Projects by status" chart total is "2"
    And the "Open tasks" widget shows the number "7"
    # Clients' options were made separately, yet a Status filter matches them by name.
    When I delete the "Budget" global filter
    And I open the dashboard filter menu
    And I pick the "Status" property of "Projects" in the filter menu
    And I select "Active" in the open global filter
    And I add the "Status" property of "Clients" to the open global filter
    Then the open global filter offers the options "Active, Paused, Done, Churned"
    When I close the global filter editor
    Then the "Status" global filter chip shows 2 sources
    And the "Status" global filter pill reads "Status: Active"
    And the "Projects by status" chart total is "3"
    And the "Active clients" widget shows the number "3"
    And the "Open tasks" widget shows the number "7"

  Scenario: Charting the open work by person, never by a formula or a rollup
    When I open the "Agency overview" dashboard
    And I switch the dashboard to Edit mode
    And I open the settings of the "Projects by status" widget
    And I open "Each slice represents" in the "Data" chart settings section
    Then the chart fields offer "Name, Status, Lead, Client, Budget" but not "Margin"
    When I open "What to show" in the "Data" chart settings section
    Then the chart fields offer "Name, Status, Lead, Client, Budget" but not "Margin"
    When I close the "View settings" panel
    And I open the settings of the "Tasks by status" widget
    And I open "What to show" in the "Y axis" chart settings section
    Then the chart fields offer "Name, Status, Assignee, Due, Project" but not "Project budget"
    When I open "What to show" in the "X axis" chart settings section
    Then the chart fields offer "Name, Status, Assignee, Due, Project" but not "Project budget"
    When I set the chart X axis to "Assignee"
    Then the "Tasks by status" chart shows 4 for me and 4 for the teammate
    When I close the "View settings" panel
    And I finish editing the dashboard
    And I reload the dashboard
    Then the "Tasks by status" chart shows 4 for me and 4 for the teammate

  Scenario: A teammate files a report and the owner filters documents by who wrote them
    When the teammate opens the "Agency overview" dashboard
    And the teammate adds a row named "Umbrella status report" in the "Documents" widget
    And I open the "Agency overview" dashboard
    Then the "Documents" widget lists "Northwind proposal, Globex contract, Q3 agency report, Umbrella status report"
    When I add a global filter on "Author" with the condition "Contains" and the value "me"
    Then the "Documents" widget lists "Northwind proposal, Globex contract, Q3 agency report"
    And the "Open tasks" widget shows the number "7"
    When I remove the global filter "Author"
    And I add a global filter on "Editor" with the condition "Contains" and the value "the teammate"
    Then the "Documents" widget lists "Umbrella status report"
