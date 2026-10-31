@dashboard @dashboard-usecase @dashboard-template-3 @cloud
Feature: On-call handbook with an embedded incident dashboard
  Based on Kanri no Yamada's dashboards placed inside a page (a callout and
  a "new applicant" button above each embedded dashboard), Ols Notion's
  creator hub page, and the Japanese "home page dashboard in a column".
  The engineering manager keeps an on-call handbook page whose embedded
  dashboard shows open incidents and downtime. Teammates read it with
  view-only access, the manager copies the block and the whole page for
  other teams, and the page is shared with an outside contractor and
  published for customers.

  # Copies follow Notion:
  # - The block menu's Duplicate copies the linked dashboard with its widgets
  #   (createLinkedDatabaseViewForLayout with duplicate: true); widgets on
  #   shared views keep pointing at them, so deleting the copy keeps them.
  # - Duplicating the page copies the dashboard view with its layout (the
  #   server's page duplicate), so the copy shows the same widgets.
  # Readers never add global filters: they give a saved filter a value of
  # their own (WP07, WP08), which stays on their device.

  Background:
    Given a workspace for the "Handbook" use case
    And an "Incidents" database with these properties:
      | property     | type   | options                            |
      | Severity     | Select | SEV1, SEV2, SEV3                   |
      | Service      | Select | API, Web, Billing                  |
      | Status       | Select | Investigating, Mitigated, Resolved |
      | Started      | Date   |                                    |
      | Minutes down | Number |                                    |
    And "Incidents" has these rows:
      | Name                  | Severity | Service | Status        | Started    | Minutes down |
      | Checkout 500s         | SEV1     | Billing | Resolved      | today - 20 | 42           |
      | Slow dashboard loads  | SEV3     | Web     | Resolved      | today - 12 | 0            |
      | Webhook retries stuck | SEV2     | API     | Mitigated     | today - 3  | 18           |
      | Login rate limiting   | SEV2     | API     | Resolved      | today - 8  | 25           |
      | Invoice PDF timeouts  | SEV3     | Billing | Investigating | today      | 0            |
      | Search index lag      | SEV2     | Web     | Investigating | today - 1  | 5            |
    And "Incidents" has these views:
      | view           | layout       | settings                           |
      | Open incidents | Number chart | count where Status is not Resolved |
      | Minutes down   | Number chart | sum of Minutes down                |
      | By service     | Donut chart  | count by Service                   |
      | Open list      | List         | where Status is not Resolved       |
    And a document named "On-call handbook" in the "Handbook" space

  Scenario: The manager builds the dashboard inside the handbook page
    Given I am editing the "On-call handbook" document
    When I link the "Incidents" database as a dashboard in the document
    Then the "On-call handbook" document holds 1 dashboard block
    And the dashboard is in Edit mode
    When I add the "Open incidents" view as a widget
    And I add the "Minutes down" view as a widget next to "Open incidents"
    And I add the "By service" view as a widget next to "Minutes down"
    And I add the "Open list" view as a widget on a new row
    And I finish editing the dashboard
    Then the dashboard shows these rows:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    # A widget joining a row splits it equally.
    And the widths of dashboard row 1 are "4, 4, 4"
    And the "Open incidents" widget shows the number "3"
    And the "Minutes down" widget shows the number "90"
    And the "By service" chart total is "6"
    # In View mode the value stays on this device until it is saved for everyone.
    When I add a global filter where "Service" is "API"
    Then the "Open incidents" widget shows the number "1"
    And the "Minutes down" widget shows the number "43"
    And the "Open list" widget lists "Webhook retries stuck"
    And the "Service" global filter shows an unsaved dot
    When I click "Save for everyone" in the filter bar
    Then no unsaved dot is shown on the dashboard
    When I reload the dashboard
    Then the "Open incidents" widget shows the number "1"
    And no unsaved dot is shown on the dashboard

  Scenario: A view-only teammate reads the handbook and narrows it for themselves
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And the "On-call handbook" dashboard has a saved "Service" global filter with no value
    And a teammate who can only view the "Handbook" space
    When the teammate opens the "On-call handbook" document
    Then the teammate sees the dashboard in View mode without an Edit button
    And the teammate sees the "Open incidents" widget show the number "3"
    And the teammate sees the "Open list" widget list "Webhook retries stuck, Invoice PDF timeouts, Search index lag"
    When the teammate changes the global filter "Service" to "Web"
    Then the teammate sees the "Open list" widget list "Search index lag"
    And the teammate sees that the global filter only applies for them
    And the "Open list" widget lists "Webhook retries stuck, Invoice PDF timeouts, Search index lag"

  Scenario: The block menu's Duplicate copies the dashboard with its widgets
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And I am editing the "On-call handbook" document
    When I duplicate the dashboard block from its block menu
    Then the "On-call handbook" document holds 2 dashboard blocks
    And the second dashboard block shows these rows:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    When I delete the second dashboard block from its block menu
    Then the "On-call handbook" document holds 1 dashboard block
    And the "Open incidents" widget shows the number "3"
    And the "Open list" view of "Incidents" still exists

  Scenario: The escalation table below the dashboard offers no dashboard in its slash menu
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And I am editing the "On-call handbook" document
    # The escalation matrix is a simple table (SIMPLE_TABLE_EXCLUDED_OPTION_KEYS).
    When I type slash in a simple table cell of the document
    Then the slash menu command "text" is visible
    And the slash menu command "dashboard" is hidden
    And the slash menu command "linkedDashboard" is hidden

  # AI meeting blocks come from meeting recordings; the step injects one
  # through the editor test hooks, which only development builds expose, and
  # skips the scenario on a production build.
  Scenario: The incident review notes offer no dashboard in their slash menu
    Given I am editing the "On-call handbook" document
    # Incident reviews are recorded in an AI meeting block (AI_MEETING_EXCLUDED_OPTION_KEYS).
    And the "On-call handbook" document has an AI meeting block
    When I type slash inside the AI meeting notes
    Then the slash menu command "text" is visible
    And the slash menu command "dashboard" is hidden
    And the slash menu command "linkedDashboard" is hidden

  Scenario: Another team gets a copy of the whole handbook
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    When I duplicate the "On-call handbook" page from the sidebar
    And I open the "On-call handbook (Copy)" document
    Then the "On-call handbook (Copy)" document holds 1 dashboard block
    And the dashboard shows these rows:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And the "Open incidents" widget shows the number "3"
    And the "Minutes down" widget shows the number "90"

  Scenario: A page-only guest cannot read the dashboard source
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And a guest invited to the "On-call handbook" page only
    When the guest opens the "On-call handbook" document
    Then the guest cannot read the "Incidents" source database

  Scenario: A contractor with explicit source access reads the handbook dashboard
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And a guest invited to the "On-call handbook" page only
    And the guest is also granted read access to the "Incidents" source database
    When the guest opens the "On-call handbook" document
    Then the guest sees the dashboard in View mode without an Edit button
    And the guest sees the "Open incidents" widget show the number "3"
    And the guest sees the "Open list" widget list "Webhook retries stuck, Invoice PDF timeouts, Search index lag"

  # Web only: the anonymous visitor of a published page. A published page is
  # served by the web app; the desktop app publishes a page but opens no
  # published page, so it has no visitor to drive (oncall_handbook.feature
  # says the same).
  @web-only
  Scenario: Customers read the published handbook and filter it only for themselves
    Given the "On-call handbook" document embeds a dashboard of "Incidents" showing:
      | row | widgets                                  |
      | 1   | Open incidents, Minutes down, By service |
      | 2   | Open list                                |
    And the "On-call handbook" dashboard has a saved "Service" global filter with no value
    When I publish the "On-call handbook" document
    And an anonymous visitor opens the published "On-call handbook" page
    Then the visitor sees the dashboard in View mode without an Edit button
    And the visitor sees the "Open incidents" widget show the number "3"
    When the visitor changes the global filter "Service" to "Web"
    Then the visitor sees the "Open list" widget list "Search index lag"
    And the visitor sees that the global filter only applies for them
    # A published page keeps nothing on the visitor's device.
    When the visitor reloads the page
    Then the visitor sees the "Open list" widget list "Webhook retries stuck, Invoice PDF timeouts, Search index lag"

  # The Pro gate is off in development builds and on self-hosted servers, so
  # the step skips this scenario on the Vite dev server; it runs against a
  # production build (CI). The billing mock answers "no active plan".
  @billing
  Scenario: On a Free workspace the dashboard slash options explain that they need Pro
    Given the workspace is on the Free plan
    And I am editing the "On-call handbook" document
    When I open the slash menu
    Then the slash menu command "dashboard" is disabled with the tooltip "Creating a Dashboard view requires a Pro workspace."
    And the slash menu command "linkedDashboard" is disabled with the tooltip "Creating a Dashboard view requires a Pro workspace."
