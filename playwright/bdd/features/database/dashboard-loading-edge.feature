@dashboard @dashboard-loading-edge
Feature: A dashboard keeps loading when a source fails, never answers, changes or is shown in another way
  # The feature text and the steps are the same as desktop
  # integration_test/desktop/bdd/database/dashboard/dashboard_loading_edge.feature
  # (missing-dashboard-tests M7, M10-M12, M17, M23-M25, M27, M29, M31). Only
  # these comments and the tags differ, and desktop steps write a parameter
  # as {2} where web writes 2.
  #
  # The worlds, the recorders and the cap checks are those of
  # dashboard-loading.feature (dashboard-loading-helpers.ts); the edges are in
  # dashboard-loading-edge-helpers.ts. A source "fails to load" when every
  # request for its rows fails while its document opens (its blob/diff walk,
  # its row documents and their realtime syncs); it "cannot be reached" when
  # every request for its data fails like a dropped connection; it "never
  # answers" when every request for its data, its permission check included,
  # stays pending.
  #
  # A real failure says "Some rows haven't loaded yet" with a retry, and a
  # slow load never turns into an error by itself (LOADING-DESIGN R8). A
  # source that never answers gives its slot up after the source load timeout
  # (tokens.json loading.sourceLoadTimeoutMs, the same on both clients).

  @cloud
  Scenario: A source that cannot be shown or fails to load gives its slot to the next widget
    Given four small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 4 widgets over the 4 databases in 1 row of 4
    And the view of the first widget is in the trash
    And the rows of the second source database fail to load
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then the first widget shows the "not-found" placeholder
    And the second widget says "Some rows haven't loaded yet"
    And the third and fourth widgets show their rows
    And no more than 2 source databases were loading at the same time

  @cloud
  Scenario: A widget whose rows fail to load says so and loads them on retry
    Given four small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 4 widgets over the 4 databases in 1 row of 4
    And the rows of the second source database fail to load
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then the second widget says "Some rows haven't loaded yet"
    And the second widget does not say it has no rows
    When the rows of the second source database can load again
    And I retry loading the second widget
    Then the second widget shows the same result as its source view

  @cloud
  Scenario: A source that cannot be reached says it is available when back online and gives its slot to the next widget
    Given four small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 4 widgets over the 4 databases in 1 row of 4
    And the first source database cannot be reached
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then the first widget shows the "offline" placeholder
    And the second, third and fourth widgets show their rows
    And no more than 2 source databases were loading at the same time

  # The member opens the dashboard in a browser of their own.
  @cloud
  Scenario: A source the member cannot open shows no access and gives its slot to the next widget
    Given four small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 4 widgets over the 4 databases in 1 row of 4
    And the first source database is in a space only its owner can open
    And a read-only member opens that dashboard with nothing cached
    Then the first widget shows the "no-access" placeholder
    And the second, third and fourth widgets show their rows
    And no more than 2 source databases were loading at the same time

  # Fix B4: without a timeout two stalled sources would hold both slots for
  # good, and every other widget would wait forever.
  @cloud
  Scenario: Sources that never answer give their slots up after the source load timeout
    Given four small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 4 widgets over the 4 databases in 1 row of 4
    And the first 2 source databases never answer
    And dashboard load counters are being recorded
    When I open that dashboard with nothing cached
    Then the third and fourth widgets do not start before the source load timeout
    And the third and fourth widgets show their rows after the source load timeout
    And no widget has looked empty so far

  # Fix B6: the menu reads each source's properties from the folder and the
  # source's own document, not from a widget that has started.
  @cloud
  Scenario: The dashboard filter menu lists the properties of sources that have not started loading
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And I open the dashboard filter menu before every widget has started
    Then the filter menu lists the properties of all 8 source databases

  @cloud
  Scenario: Rows a collaborator adds while widgets load or wait for a source are shown
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    And a collaborator adds a row to the first source database while its widget loads
    And a collaborator adds a row to the last source database before its widget starts
    Then the widgets of the first and last source databases list the rows the collaborator added
    And every widget shows the same result as its source view

  # A blob/diff page holds up to 256 rows, so 600 rows arrive in 3 pages;
  # every page after the first answers 1.5 s later. One row in 50 has 0
  # Points, so the second widget lists a few rows per page and its loading
  # row stays in view below them.
  @cloud
  Scenario: The loading row of a database read in pages counts its rows and always settles
    Given a database of 600 rows has a grid view and a grid view of its rows whose Points are 0
    And a new database has a dashboard showing those 2 views
    And dashboard load counters are being recorded
    When I open that dashboard while every page after the first loads slowly
    Then the second widget shows a loading row reading "Loading rows… N/M"
    And the count in the loading row of the second widget only grows and its total is the row count of the database
    And the second widget shows no loading row within 5 seconds of its last row
    And no widget looked empty while it loaded
    And every widget shows the same result as its source view

  @cloud
  Scenario: A chart or number widget never shows a partial result as final
    Given a database of 600 rows has a number view summing Points and a bar chart view counting rows by Status
    And a new database has a dashboard showing those 2 views
    And dashboard load counters are being recorded
    When I open that dashboard while every page after the first loads slowly
    Then until its rows finished loading the number widget showed a loading state or its final value
    And until its rows finished loading the bar chart widget showed a loading state or its final bars
    And neither widget said "No data" before its rows finished loading

  @cloud
  Scenario: Board, calendar and timeline widgets of a slow source show a loading state, never an empty board, month or lane
    Given a small database with dates has a board view, a calendar view and a timeline view
    And a new database has a dashboard showing those 3 views
    And dashboard load counters are being recorded
    When I open that dashboard while every source database loads slowly
    Then until its rows arrived every widget showed a loading state, never an empty board, month or lane
    And every widget ends with a card, an event or a bar for every row of the database

  @cloud
  Scenario: The version history preview of a dashboard loads no widget
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And a version of the dashboard's database was saved
    And dashboard load counters are being recorded
    When I preview the dashboard in the version history of its database
    Then the preview says dashboards are not previewed and shows no widget
    And no source database was requested while the preview was open

  @cloud
  Scenario: Leaving the dashboard keeps nothing of it
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I visit the dashboard and leave it once
    And I measure what the page holds
    And I visit the dashboard and leave it 3 more times
    Then the page holds at most 10 percent more than after the first visit
    And no dashboard widget session is left open

  # tokens.json loading.sourceIdleReleaseMs: the step stays away that long
  # and a few seconds more.
  @cloud
  Scenario: Sources released after the idle time load cold again, two at a time
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And I opened that dashboard and it finished loading
    And dashboard load counters are being recorded
    When I open another page and stay there until every source database is released for being idle
    And I return to the dashboard while every source database loads slowly
    Then every source database took a load slot again
    And no more than 2 source databases were loading at the same time
    And every widget that waited for a source was seen waiting with its header and a loading state
    And every widget shows the same result as its source view

  @cloud
  Scenario: On a phone the widgets stack one per line and load two sources at a time
    Given eight small databases each have a grid view for a dashboard widget
    And a new database has a dashboard with 8 widgets over the 8 databases in 2 rows of 4
    And dashboard load counters are being recorded
    When I open that dashboard on a phone while every source database loads slowly
    Then the widgets are stacked one per line
    And the dashboard offers no Edit button
    And no more than 2 source databases were loading at the same time
    And every widget that waited for a source was seen waiting with its header and a loading state
