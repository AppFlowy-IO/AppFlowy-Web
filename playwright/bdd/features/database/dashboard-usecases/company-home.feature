@dashboard @dashboard-usecase @cloud
Feature: Company home page across three databases
  Based on Notion's official "Company Databases" dashboard, a company-wide
  front page that combines projects, docs and the sales pipeline from
  separate databases, and on "Business in a Box", which keeps several
  dashboards for different audiences on one database.

  Background:
    Given a workspace for the "Company home" use case
    And a "Company projects" database with these properties:
      | property | type   | options                       |
      | Status   | Select | Planned, In progress, Blocked |
      | Owner    | Select | Nora, Omar                    |
    And "Company projects" has these rows:
      | Name                          | Status      | Owner |
      | Realtime collaboration engine | In progress | Nora  |
      | AI onboarding coach           | Planned     | Omar  |
      | Billing and usage analytics   | Blocked     | Nora  |
    And a "Docs" database with these properties:
      | property | type   | options           |
      | Type     | Select | Spec, Plan, Notes |
      | Owner    | Select | Nora, Omar        |
    And "Docs" has these rows:
      | Name                      | Type  | Owner |
      | Collab engine spec        | Spec  | Nora  |
      | Q3 roadmap                | Plan  | Omar  |
      | Onboarding research notes | Notes | Omar  |
      | Billing migration plan    | Plan  | Nora  |
    And a "CRM" database in a separate private space with these properties:
      | property | type   | options                                |
      | Stage    | Select | Lead, Qualified, Proposal, Won, Lost   |
      | Value    | Number |                                        |
      | Owner    | Select | Nora, Omar                             |
    And "CRM" has these rows:
      | Name           | Stage     | Value  | Owner |
      | NimbusOps      | Lead      | 18000  | Nora  |
      | ByteGarden     | Qualified | 25000  | Omar  |
      | VectorForge    | Proposal  | 45000  | Nora  |
      | Acme Analytics | Proposal  | 120000 | Omar  |
      | Orbitly        | Won       | 60000  | Nora  |
    And "Company projects" has these views:
      | view            | layout  | settings |
      | Project gallery | Gallery |          |
    And "Docs" has these views:
      | view        | layout | settings |
      | Recent docs | List   |          |
    And "CRM" has these views:
      | view           | layout       | settings     |
      | Pipeline value | Number chart | sum of Value |
      | Deals          | Grid         |              |

  Scenario: The operations lead assembles the company home page
    When I create a dashboard named "Company home" on "Company projects"
    And I add the "Project gallery" view as a widget
    And I search for "Pipeline" and add the "Pipeline value" view as a widget next to "Project gallery"
    And I search for "Docs" and add the "Recent docs" view as a widget on a new row
    And I search for "CRM" and add the "Deals" view as a widget next to "Recent docs"
    And I finish editing the dashboard
    Then the dashboard shows these rows:
      | row | widgets                        |
      | 1   | Project gallery, Pipeline value |
      | 2   | Recent docs, Deals             |
    And the "Project gallery" widget shows the cards "Realtime collaboration engine, AI onboarding coach, Billing and usage analytics"
    And the "Pipeline value" widget shows the number "268,000"
    And the "Recent docs" widget lists "Collab engine spec, Q3 roadmap, Onboarding research notes, Billing migration plan"
    And the "Deals" widget lists "NimbusOps, ByteGarden, VectorForge, Acme Analytics, Orbitly"

  Scenario: One owner filter across teams, except where it does not apply
    Given the "Company home" dashboard on "Company projects" shows:
      | row | widgets                         |
      | 1   | Project gallery, Pipeline value |
      | 2   | Recent docs, Deals              |
    When I add a global filter where "Owner" is "Nora"
    Then the "Owner" global filter chip shows 3 sources
    When I stop applying the global filter "Owner" to "Docs"
    Then the "Owner" global filter chip shows 2 sources
    And the "Pipeline value" widget shows the number "123,000"
    And the "Deals" widget lists "NimbusOps, VectorForge, Orbitly"
    And the "Project gallery" widget shows the cards "Realtime collaboration engine, Billing and usage analytics"
    And the "Recent docs" widget lists "Collab engine spec, Q3 roadmap, Onboarding research notes, Billing migration plan"

  Scenario: A colleague without CRM access still gets the rest of the page
    Given the "Company home" dashboard on "Company projects" shows:
      | row | widgets                         |
      | 1   | Project gallery, Pipeline value |
      | 2   | Recent docs, Deals              |
    And a teammate who can only view the "Company home" space
    When the teammate opens the "Company home" dashboard
    Then the teammate sees the "Pipeline value" widget explain that they have no access
    And the teammate sees the "Deals" widget explain that they have no access
    And the teammate sees the "Recent docs" widget list "Collab engine spec, Q3 roadmap, Onboarding research notes, Billing migration plan"

  Scenario: Separate dashboards for separate audiences
    Given the "Company home" dashboard on "Company projects" shows:
      | row | widgets                         |
      | 1   | Project gallery, Pipeline value |
      | 2   | Recent docs, Deals              |
    And the "Sales" dashboard on "Company projects" shows:
      | row | widgets               |
      | 1   | Pipeline value, Deals |
    When I open the "Sales" dashboard
    Then the dashboard shows these rows:
      | row | widgets               |
      | 1   | Pipeline value, Deals |
    When I open the "Company home" dashboard
    Then the dashboard shows these rows:
      | row | widgets                         |
      | 1   | Project gallery, Pipeline value |
      | 2   | Recent docs, Deals              |
