@dashboard @dashboard-loading
Feature: A dashboard loads each source database once, two at a time, visible widgets first
  # The feature text and the steps are the same as desktop
  # integration_test/desktop/bdd/database/dashboard/dashboard_loading.feature
  # (fix pass section 6.2, addendum A9). Only these comments and the tags
  # differ, and desktop steps write a parameter as {2} where web writes 2.
  # @dashboard-loading scopes the steps this feature shares with
  # dashboard-large-source.feature.
  #
  # At most 2 distinct source databases load at a time (tokens.json
  # loading.maxConcurrentSources); visible widgets start first; a widget
  # waiting for a slot shows its header and the loading placeholder, never an
  # empty table; a finished or failed load frees its slot; leaving the
  # dashboard cancels the queue.
  #
  # The checks read three records: the app's load counters
  # (window.__DASHBOARD_LOAD_STATS__), the document and blob/diff requests of
  # each source database, and a look at every widget every 100 ms
  # (dashboard-loading-helpers.ts). "With nothing cached" deletes IndexedDB
  # and the databases' delta cursors in localStorage first; "loads slowly"
  # does too, then holds every response of the database back 3 s.
  #
  # The employees scenarios use the employees fixture of the large-database
  # suite and are skipped unless RUN_LARGE_DATABASE is set:
  #   npx bddgen -c playwright.bdd.config.ts
  #   RUN_LARGE_DATABASE=1 npx playwright test -c playwright.bdd.config.ts --grep @dashboard-loading --workers=1
  # EMPLOYEES_ROW_LIMIT=2000 seeds the 2,000 rows of the measurements, and
  # LARGE_DATABASE_CACHE=<file> reuses a seeded account across runs.

  @cloud
  Scenario: A dashboard with 8 widgets over 8 databases never loads more than 2 sources at once
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget frame was shown before any row data arrived
    And no more than 2 source databases were loading at the same time
    And every widget waiting for a source showed a loading state that was not empty
    And every source database was opened once
    And every widget shows the same result as its source view

  @large-database
  Scenario: 12 widgets over one large database load the database once
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then the employees database was opened once
    And the employees rows were loaded in one pass
    And no widget looked empty while it loaded
    And every widget shows the same result as its source view

  @large-database
  Scenario: Widgets below the fold load after visible ones
    Given the employees database is open
    And three small databases each have 3 views for dashboard widgets
    And a new database has a dashboard with 12 widgets over 4 databases in 4 rows of 3
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget frame was shown before any row data arrived
    And every visible widget started loading before any widget below the fold
    And no database used only below the fold was opened before the visible widgets showed data
    When I scroll to the last dashboard row
    Then every widget in the last row shows its rows

  @large-database
  Scenario: A slow source does not delay other widgets
    Given the employees database is open
    And three small databases each have 3 views for dashboard widgets
    And a new database has a dashboard with 12 widgets over 4 databases in 4 rows of 3
    And dashboard load counters are being recorded
    When I open that dashboard while the employees database loads slowly
    Then every visible widget of the other databases shows its rows within 7 seconds
    And the employees widgets show a loading state that is not empty
    And no more than 2 source databases were loading at the same time
    When I scroll to the last dashboard row
    Then every widget in the last row shows its rows within 3 seconds
    And the employees widgets end with the same result as their source views

  @cloud
  Scenario: Leaving the dashboard cancels its queued loads
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And I leave the dashboard before every widget has started
    Then no source database starts loading after I left
