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

  # The cap is reached and never exceeded, proven from the requests in flight
  # and the looks at every widget, not only from the app's own counter
  # (missing-dashboard-tests M2). "Was seen waiting" means the page saw the
  # widget's header and the loading placeholder before its database's first
  # request, for every widget of the third and later databases requested.
  @cloud
  Scenario: With every source slow, exactly 2 source databases load at a time and the rest wait with a loading state
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    Then 2 source databases were loading at the same time at the peak
    And no more than 2 source databases were loading at the same time
    And every widget that waited for a source was seen waiting with its header and a loading state
    And every source database was opened once
    And every widget shows the same result as its source view

  # M28: the most widgets a dashboard holds, each on its own database.
  @cloud
  Scenario: A dashboard with 12 widgets over 12 databases loads 2 sources at a time
    Given twelve small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 12 widgets over the 12 databases in 3 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    Then 2 source databases were loading at the same time at the peak
    And no more than 2 source databases were loading at the same time
    And every widget that waited for a source was seen waiting with its header and a loading state
    And every source database was opened once
    And every widget shows the same result as its source view

  # M3: the cap counts databases, not widgets. Each row shows one database's
  # grid and a second, sorted grid of it.
  @cloud
  Scenario: Widgets that share a database share one load slot
    Given three small databases each have 2 views for dashboard widgets
    And a new database has a dashboard with 6 widgets over 3 databases in 3 rows of 2
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    Then both widgets of each loading database started together
    And no more than 2 source databases were loading at the same time
    And every source database was opened once
    And the rows of every source database were loaded in one pass

  # M4: a source whose rows the tab still holds (the idle release has not
  # run) is warm: its widgets skip the queue. "Another page" is a separate
  # document in the workspace, reached and left without a browser reload.
  @cloud
  Scenario: Reopening the dashboard starts every widget at once and loads no rows again
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I open another page and return to the dashboard within 30 seconds
    Then no widget waited for a source
    And no source database was opened or loaded again
    And every widget shows its data within 3 seconds
    And every widget shows the same result as its source view

  # M5: the window is longer than two slow responses, so a slot freed by a
  # load in flight would have started a queued widget in it.
  @cloud
  Scenario: Leaving the dashboard stops the loads that had started and never starts the queued ones
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And I leave the dashboard before every widget has started
    Then no source database starts loading within 10 seconds after I left
    And the source databases that were loading stop loading rows after I left
    And no dashboard widget session is left open

  # M8: the cap is hard (fix pass Q1): two slow sources hold both slots.
  @cloud
  Scenario: Two slow sources hold both slots and the other widgets wait without looking empty
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while the first 2 source databases load slowly
    Then the widgets of the other databases show a loading state until a slow database finishes
    And no widget shows an error or an empty state while it waits
    And every widget shows the same result as its source view

  # M9: one widget per row, so rows 3 to 8 start below the fold. Scrolling to
  # the last row brings rows 6 to 8 into view; rows 3 to 5 are never in view,
  # and the layout order would start them first.
  @cloud
  Scenario: Scrolling to a waiting widget starts it before the other waiting widgets
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 8 rows of 1
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And I scroll to the last dashboard row before the visible widgets show data
    Then the widget in the last row started loading before every widget that was never scrolled into view
    And the widget in the last row was visible when it started

  # M9: tokens.json loading.deferredStartTimeoutMs. The first database holds
  # every response back 20 s, so its widget shows no data for about 40 s.
  @cloud
  Scenario: Widgets below the fold start 10 seconds after the visible ones when a visible source is slow
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 8 rows of 1
    And dashboard load counters are being recorded
    When I open that dashboard while the first source database loads with a delay of 20 seconds
    Then no widget below the fold started in the first 10 seconds
    And a widget below the fold started before the first source database showed data

  # M16: the header and its menu work while a widget waits for its source.
  @cloud
  Scenario: A widget removed while it waits for a source never loads its database
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And I remove the last widget before it has started
    Then the database of the removed widget was never opened
    And every remaining widget shows the same result as its source view

  # M20: the member opens the dashboard in a browser of their own.
  @cloud
  Scenario: A read-only member's dashboard loads two sources at a time with loading states
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And a read-only member opens that dashboard with nothing cached
    Then no more than 2 source databases were loading at the same time
    And every widget waiting for a source showed a loading state that was not empty
    And every widget shows the same result as its source view

  # Count budgets shared with desktop (performance plan T2).
  @large-database
  Scenario: A dashboard inside its own source database starts the visible widgets first
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And the employees database has a dashboard with 12 widgets showing its views in 4 rows of 3
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget frame was shown before any row data arrived
    And every visible widget started loading before any widget below the fold
    And every widget below the fold waited for the visible widgets to show data or for 10 seconds
    And every widget shows the same result as its source view

  # 4.4 #2, budget 5 (W3, D9): the employees database answers 6 s late
  # after the return, so a widget that went back to it would be late.
  @large-database
  Scenario: Reopening the dashboard shows its rows without waiting for the source database
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I open another page and return to the dashboard within 30 seconds while the employees database loads with a delay of 6 seconds
    Then every visible widget shows its data within 3 seconds
    And no source database was opened or loaded again

  # 4.4 #3, budget 5 (W6).
  @large-database
  Scenario: Returning from another tab of the same database loads nothing again
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And the employees database has a dashboard with 12 widgets showing its views in 4 rows of 3
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I open the Grid tab of the employees database and return to the dashboard tab
    Then no source database was opened or loaded again
    And every widget shows the same result as its source view

  # 4.4 #5, budget 3 (D1, W16).
  @large-database
  Scenario: Charts and number cards do not read the source rows again
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget shows the same result as its source view
    And the employees rows were read from storage at most once

  # 4.4 #6, budget 8 (D1, W23).
  @large-database
  Scenario: Editing a cell changes each chart that shows it once and leaves the others alone
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I change the Department of the first employee in the plain grid widget
    Then each Department chart shows the change and changed exactly once
    And the other charts and number cards did not change
    And the employees rows were not read from storage again

  # 4.4 #7, budget 7 (D3, W20).
  @large-database
  Scenario: List and gallery widgets on a large source ask for per-row data only for the rows they show
    Given the employees database is open
    And the employees database has a list view and a gallery view for dashboard widgets
    And a new database has a dashboard with the employees list and gallery views in 1 row of 2
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget shows the same result as its source view
    And each widget asked for per-row data only for the rows it showed

  # 4.4 #8, budget 11 (D8): databases of 300, 60 and 20 rows.
  @cloud
  Scenario: Widgets of sources under 500 rows show data before their sources bind every row
    Given three small databases each have 1 views for dashboard widgets
    And a new database has a dashboard with 3 widgets over 3 databases in 1 rows of 3
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then every widget shows the same result as its source view
    And no source database bound more than 50 rows
