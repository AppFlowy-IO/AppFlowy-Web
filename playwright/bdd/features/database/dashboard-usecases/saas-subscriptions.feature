@dashboard @dashboard-usecase @dashboard-template-3 @cloud
Feature: SaaS subscriptions tracker survives a quarterly clean-up
  Based on the subscriptions tracker shared by a Notion dashboards engineer
  (a "$ / month" number, count by status, a renewing-soon list, spend by
  category and a table of every subscription) and the CFO Executive
  Snapshot. Once a quarter the operations admin cleans the workspace up:
  trashes and restores a database, deletes a stale view, retypes and deletes
  properties, restores an earlier version, and duplicates the tracker for
  next year's budget. The dashboard must survive all of it.

  # "Renewing next week" is a relative view filter computed against today: a
  # renewal 7 days out is always next week and one 14 days out never is (a
  # run that crosses midnight can still flake).

  Background:
    Given a workspace for the "Operations" use case
    And a "Subscriptions" database with these properties:
      | property     | type   | options                         |
      | Status       | Select | Active, Trial, Cancelled        |
      | Category     | Select | Engineering, Design, Sales, Ops |
      | Monthly cost | Number |                                 |
      | Seats        | Number |                                 |
      | Renews       | Date   |                                 |
      | Owner        | Select | Priya, Tom                      |
    And the "Monthly cost" property of "Subscriptions" uses the "US dollar" number format
    And "Subscriptions" has these rows:
      | Name       | Status    | Category    | Monthly cost | Seats | Renews     | Owner |
      | GitHub     | Active    | Engineering | 441          | 21    | today + 7  | Priya |
      | Figma      | Active    | Design      | 225          | 5     | today + 40 | Tom   |
      | Salesforce | Active    | Sales       | 900          | 6     | today + 14 | Tom   |
      | Notion AI  | Trial     | Ops         | 0            | 40    | today + 30 | Priya |
      | Zoom       | Cancelled | Ops         | 150          | 10    | today - 10 | Tom   |
      | Linear     | Active    | Engineering | 160          | 20    | today + 7  | Priya |
      | Loom       | Active    | Ops         | 60           | 5     | today + 60 | Tom   |
      | Datadog    | Active    | Engineering | 1230         | 1     | today + 21 | Priya |
    And a "Vendors" database with these properties:
      | property     | type   | options             |
      | Tier         | Select | Strategic, Standard |
      | Contract end | Date   |                     |
    And "Vendors" has these rows:
      | Name        | Tier      | Contract end |
      | GitHub Inc. | Strategic | today + 200  |
      | Salesforce  | Strategic | today + 100  |
      | Loom        | Standard  | today + 60   |
    And "Subscriptions" has these views with their chart settings:
      | view               | layout               | settings                                                              |
      | $ / month          | Number chart         | sum of Monthly cost, titled "$ / month" where Status is not Cancelled |
      | By status          | Horizontal bar chart | count by Status                                                       |
      | Spend by category  | Bar chart            | sum of Monthly cost by Category where Status is not Cancelled         |
      | Renewing next week | List                 | where Renews is next week                                             |
      | All subscriptions  | Grid                 |                                                                       |
    And "Vendors" has these views:
      | view    | layout | settings |
      | Vendors | Grid   |          |
    And the "Spend" dashboard on "Subscriptions" shows:
      | row | widgets                                 |
      | 1   | $ / month, By status, Spend by category |
      | 2   | Renewing next week, Vendors             |
      | 3   | All subscriptions                       |

  Scenario: A trashed database comes back, a deleted view leaves a placeholder
    When I open the "Spend" dashboard
    Then the "$ / month" widget shows the number "$3,016"
    And the "Renewing next week" widget lists "GitHub, Linear"
    When the "Vendors" database is moved to the trash
    And I reload the dashboard
    Then the "Vendors" widget shows the "not-found" placeholder
    When I restore the "Vendors" database from the trash
    And I open the "Spend" dashboard
    Then the "Vendors" widget lists "GitHub Inc., Salesforce, Loom"
    When I delete the "Renewing next week" view of "Subscriptions"
    And I open the "Spend" dashboard
    Then the "Renewing next week" widget shows the "not-found" placeholder
    When I switch the dashboard to Edit mode
    And I remove the "Renewing next week" widget from its placeholder
    Then the dashboard shows 5 widgets
    And the widths of dashboard row 2 are "12"
    And the "$ / month" widget shows the number "$3,016"

  Scenario: Retyping a filtered property, then deleting a charted and a summed one
    When I open the "Spend" dashboard
    # Added in Edit mode, so the filter is saved for everyone.
    And I switch the dashboard to Edit mode
    And I add a global filter where "Owner" is "Priya"
    And I finish editing the dashboard
    Then the "$ / month" widget shows the number "$1,831"
    And the "Spend by category" chart shows these values:
      | label       | value |
      | Engineering | 1,831 |
      | Ops         | 0     |
    When I change the "Owner" property of "Subscriptions" to a "Text" property
    And I open the "Spend" dashboard
    Then the "Owner" global filter no longer applies to "Subscriptions"
    And the "$ / month" widget shows the number "$3,016"
    # Removed in Edit mode too: the filter is part of the saved dashboard.
    When I switch the dashboard to Edit mode
    And I remove the global filter "Owner"
    And I finish editing the dashboard
    Then the dashboard shows 0 global filter chips
    # The X axis falls back to the first property that can group, Status.
    When the "Category" property of "Subscriptions" is deleted
    Then the "Spend by category" chart shows these values:
      | label  | value |
      | Active | 3,016 |
      | Trial  | 0     |
    And the "By status" chart shows these values:
      | label     | value |
      | Active    | 6     |
      | Cancelled | 1     |
      | Trial     | 1     |
    # Without its value property a chart counts rows (effectiveChartAggregation):
    # the tile silently becomes a row count under its custom title.
    When the "Monthly cost" property of "Subscriptions" is deleted
    Then the "$ / month" widget shows the caption "$ / month" above the number "7"
    And the "Spend by category" chart shows these values:
      | label  | value |
      | Active | 6     |
      | Trial  | 1     |

  Scenario: Restoring the version from before a cancellation
    Given the "Subscriptions" database has a saved version
    When I open the "Spend" dashboard
    And I change the "Status" of "Datadog" to "Cancelled" in the "All subscriptions" widget
    Then the "$ / month" widget shows the number "$1,786"
    When I open the version history of the "Subscriptions" database
    And I preview the "Spend" view of the saved version
    Then the history preview explains that dashboards are not previewed
    When I restore the saved version
    Then the "Status" of "Datadog" in "Subscriptions" is "Active"
    When I open the "Spend" dashboard
    Then the dashboard shows these rows:
      | row | widgets                                 |
      | 1   | $ / month, By status, Spend by category |
      | 2   | Renewing next week, Vendors             |
      | 3   | All subscriptions                       |
    And the "$ / month" widget shows the number "$3,016"

  Scenario: Duplicating the tracker for next year's budget
    When I duplicate the "Subscriptions" database from the sidebar
    And I open the "Spend" dashboard of the copy of "Subscriptions"
    Then the dashboard shows these rows:
      | row | widgets                                 |
      | 1   | $ / month, By status, Spend by category |
      | 2   | Renewing next week, Vendors             |
      | 3   | All subscriptions                       |
    And the "$ / month" widget shows the number "$3,016"
    And the "Vendors" widget lists "GitHub Inc., Salesforce, Loom"

  Scenario: Edits made in the copy's dashboard stay in the copy
    When I duplicate the "Subscriptions" database from the sidebar
    And I open the "Spend" dashboard of the copy of "Subscriptions"
    And I change the "Monthly cost" of "GitHub" to "500" in the "All subscriptions" widget
    Then the "$ / month" widget shows the number "$3,075"
    When I open the "Spend" dashboard
    Then the "$ / month" widget shows the number "$3,016"
    And the "Monthly cost" of "GitHub" in "Subscriptions" is "441"
