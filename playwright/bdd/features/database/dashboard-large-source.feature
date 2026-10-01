@dashboard @large-database
Feature: A dashboard widget on a large database shows its rows while they load
  A dashboard grid widget whose source is another, large database used to
  show a bare loading placeholder until every row of that database had been
  read, which looked like an empty result for seconds. The widget now lists
  the matches among the rows it has read so far, with a "Loading rows…" row
  below them, and ends at exactly the rows its source view lists.

  Matches show from the first row of the view on, so rows never move while
  more load.

  # The feature text and the steps are the same as desktop
  # dashboard_large_source.feature (user report: an HR widget on the 5000-row
  # "5000_employees" database looked empty for seconds on web and for about
  # 53 s on desktop). Only these comments and the tags differ, and desktop
  # steps write a parameter as {'HR'} where web writes "HR".
  #
  # The source is the employees fixture of the large-database suite (see
  # formula-large-database.feature). The suite is slow and is skipped unless
  # RUN_LARGE_DATABASE is set:
  #   npx bddgen -c playwright.bdd.config.ts
  #   RUN_LARGE_DATABASE=1 npx playwright test -c playwright.bdd.config.ts --grep @large-database --workers=1
  # EMPLOYEES_ROW_LIMIT seeds fewer rows for a quick run, and
  # LARGE_DATABASE_CACHE=<file> reuses a seeded account across runs. A server
  # that requires a Pro plan for Dashboard views also needs
  # APPFLOWY_TEST_POSTGRES_CONTAINER (see subscription-test-helpers.ts).
  #
  # The web reads rows in the order the server sends them. Rows created
  # through the web get random ids and arrive in any order, so the HR view is
  # listed in that order, as in a database imported in one go: its first rows
  # arrive with the first page. "Loads slowly" reloads the page with every
  # blob page after the first delayed. The web's loading row also counts the
  # rows read so far: "Loading rows… N/M".

  Background:
    Given the 5000 employees database is open
    And the employees database has a grid view filtered to the "HR" department
    And a new database has a dashboard showing its own grid and the employees HR view

  Scenario: The HR widget lists its first employees before the employees database finishes loading
    When I open that dashboard while the employees database loads slowly
    Then the HR widget shows its first HR employees within 5 seconds, above a loading row
    And the HR widget lists every HR employee of the fixture
    And the HR widget never looked empty while it loaded
