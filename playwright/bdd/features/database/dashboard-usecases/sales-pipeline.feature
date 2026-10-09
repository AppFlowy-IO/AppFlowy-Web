@dashboard @dashboard-usecase @cloud
Feature: Sales pipeline dashboard
  Based on Notion's official "Sales CRM" template, whose dashboard shows the
  total pipeline, closed revenue per account owner, value by rep and a board
  of deals by stage. A sales lead builds it once; reps work their deals from
  it every day.

  Background:
    Given a workspace for the "Sales pipeline" use case
    And a "Sales CRM" database with these properties:
      | property | type   | options                                            |
      | Stage    | Select | Lead, Qualified, Proposal, Negotiation, Closed, Lost |
      | Owner    | Select | Alice, Bob, Carol                                  |
      | Value    | Number |                                                    |
    And "Sales CRM" has these rows:
      | Name          | Stage       | Owner | Value  |
      | Future Labs   | Lost        | Alice | 20000  |
      | Mode          | Qualified   | Bob   | 125000 |
      | Summly        | Proposal    | Alice | 30000  |
      | Tims          | Closed      | Bob   | 50000  |
      | Reach.io      | Closed      | Alice | 250000 |
      | Wondertrust   | Lead        | Carol | 25000  |
      | Bark          | Lead        | Bob   | 20000  |
      | Sales Wizard  | Proposal    | Carol | 110000 |
      | Frontier Tech | Negotiation | Alice | 30000  |
      | Boardly       | Lead        | Carol | 30000  |
    And "Sales CRM" has these views:
      | view           | layout       | settings                                   |
      | Total pipeline | Number chart | sum of Value                               |
      | Closed ARR     | Donut chart  | sum of Value by Owner where Stage is Closed |
      | Value by rep   | Bar chart    | sum of Value by Owner                      |
      | By stage       | Board        | grouped by Stage                           |
      | Open deals     | Grid         | where Stage is not Closed, Lost            |

  Scenario: The sales lead builds the pipeline dashboard from existing views
    When I create a dashboard named "Pipeline" on "Sales CRM"
    And I add the "Total pipeline" view as a widget
    And I add the "Closed ARR" view as a widget next to "Total pipeline"
    And I add the "Value by rep" view as a widget next to "Closed ARR"
    And I add the "By stage" view as a widget on a new row
    And I finish editing the dashboard
    Then the dashboard shows these rows:
      | row | widgets                                  |
      | 1   | Total pipeline, Closed ARR, Value by rep |
      | 2   | By stage                                 |
    And the "Total pipeline" widget shows the number "690,000"
    And the "Closed ARR" chart total is "300,000"
    And the "Value by rep" chart shows these values:
      | label | value   |
      | Alice | 330,000 |
      | Bob   | 195,000 |
      | Carol | 165,000 |
    And the "By stage" board column "Closed" has the cards "Tims, Reach.io"
    When I reload the dashboard
    Then the dashboard opens in View mode with the same rows

  Scenario: A rep closes a deal by dragging it on the board widget
    Given the "Pipeline" dashboard on "Sales CRM" shows:
      | row | widgets                                  |
      | 1   | Total pipeline, Closed ARR, Value by rep |
      | 2   | By stage                                 |
    When I drag the "Frontier Tech" card to the "Closed" column in the "By stage" widget
    Then the "By stage" board column "Closed" has the cards "Tims, Reach.io, Frontier Tech"
    And the "Closed ARR" chart total is "330,000"
    And the "Total pipeline" widget shows the number "690,000"
    And the "Stage" of "Frontier Tech" in "Sales CRM" is "Closed"

  Scenario: A rep updates a deal's value without leaving the dashboard
    Given the "Pipeline" dashboard on "Sales CRM" shows:
      | row | widgets                    |
      | 1   | Total pipeline, Open deals |
    When I change the "Value" of "Mode" to "150000" in the "Open deals" widget
    Then the "Total pipeline" widget shows the number "715,000"
    And the "Value" of "Mode" in "Sales CRM" is "150000"

  Scenario: A rep narrows the whole dashboard to their own deals
    Given the "Pipeline" dashboard on "Sales CRM" shows:
      | row | widgets                                  |
      | 1   | Total pipeline, Closed ARR, Value by rep |
      | 2   | By stage                                 |
    When I add a global filter where "Owner" is "Alice"
    Then the "Total pipeline" widget shows the number "330,000"
    And the "Closed ARR" chart total is "250,000"
    And the "By stage" widget shows the cards "Future Labs, Summly, Reach.io, Frontier Tech"
    When I remove the global filter "Owner"
    Then the "Total pipeline" widget shows the number "690,000"
