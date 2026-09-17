@dashboard @dashboard-usecase @cloud
Feature: Executive KPI review
  Based on the "KPI Command Centre" and "Strategy & KPI OS" templates in
  Notion's dashboard collection (a "needs attention" number tile, a
  scorecard health donut, a table of metrics needing attention and a table
  of the latest readings). The strategy lead maintains it; executives read it
  with view-only access, often on a phone.

  Background:
    Given a workspace for the "KPI review" use case
    And a "KPIs" database with these properties:
      | property | type   | options                        |
      | Target   | Number |                                |
      | Current  | Number |                                |
      | Status   | Select | On track, At risk, Off target  |
      | Quarter  | Select | Q2, Q3                         |
    And "KPIs" has these rows:
      | Name                       | Target | Current | Status   | Quarter |
      | Delivery admin hours       | 22     | 26      | On track | Q3      |
      | Client implementation rate | 80     | 58      | At risk  | Q3      |
      | Gross margin               | 70     | 61      | On track | Q3      |
      | Productized revenue share  | 50     | 34      | At risk  | Q2      |
      | Monthly qualified leads    | 40     | 27      | On track | Q2      |
    And a "KPI readings" database with these properties:
      | property | type   | options |
      | Value    | Number |         |
      | Taken    | Date   |         |
    And "KPI readings" has these rows:
      | Name                       | Value | Taken      |
      | Gross margin               | 61    | today - 1  |
      | Client implementation rate | 58    | today - 3  |
      | Delivery admin hours       | 26    | today - 7  |
      | Monthly qualified leads    | 27    | today - 10 |
    And "KPIs" has these views:
      | view                      | layout       | settings                               |
      | Needs attention           | Number chart | count where Status is At risk, Off target |
      | Scorecard health          | Donut chart  | count by Status                        |
      | Metrics needing attention | Grid         | where Status is At risk, Off target    |
      | All KPIs                  | Grid         |                                        |
    And "KPI readings" has these views:
      | view            | layout | settings                  |
      | Latest readings | Grid   | sorted by Taken descending |
    And the "Scorecard" dashboard on "KPIs" shows:
      | row | widgets                                    |
      | 1   | Needs attention, Scorecard health          |
      | 2   | Metrics needing attention, Latest readings |
      | 3   | All KPIs                                   |
    And an executive who can only view the "KPI review" space

  Scenario: The executive reads the scorecard
    When the executive opens the "Scorecard" dashboard
    Then the executive sees the dashboard in View mode without an Edit button
    And the executive sees the "Needs attention" widget show the number "2"
    And the executive sees the "Metrics needing attention" widget list "Client implementation rate, Productized revenue share"
    And the executive sees the "Latest readings" widget list in order "Gross margin, Client implementation rate, Delivery admin hours, Monthly qualified leads"
    When the executive opens the "Client implementation rate" row from the "Metrics needing attention" widget
    Then the executive sees the row page for "Client implementation rate"

  Scenario: The strategy lead flags a metric and the executive sees it live
    Given the executive has the "Scorecard" dashboard open
    When I open the "Scorecard" dashboard
    And I change the "Status" of "Gross margin" to "At risk" in the "All KPIs" widget
    Then the executive sees the "Needs attention" widget show the number "3"
    And the executive sees the "Metrics needing attention" widget list "Client implementation rate, Gross margin, Productized revenue share"

  Scenario: The quarterly review filter is shared with everyone
    When I open the "Scorecard" dashboard
    And I switch the dashboard to Edit mode
    And I add a global filter where "Quarter" is "Q3"
    And I finish editing the dashboard
    Then the "Needs attention" widget shows the number "1"
    When the executive opens the "Scorecard" dashboard
    Then the executive sees the global filter "Quarter: Is Q3"
    And the executive sees the "Needs attention" widget show the number "1"
    When the executive changes the global filter "Quarter" to "Q2"
    Then the executive sees the "Needs attention" widget show the number "1"
    And the executive sees the "Metrics needing attention" widget list "Productized revenue share"
    And the executive sees that the global filter only applies for them
    When the executive reloads the page
    Then the executive sees the global filter "Quarter: Is Q3"

  Scenario: The executive checks the scorecard on a phone
    When the executive opens the "Scorecard" dashboard on a 390 by 844 screen
    Then the executive sees every widget stacked in a single column
    And the executive sees the "Needs attention" widget show the number "2"
