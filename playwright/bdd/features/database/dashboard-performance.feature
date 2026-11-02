@dashboard @dashboard-perf @large-database
Feature: A 12-widget dashboard over the employees database stays within its performance budgets

  # Production build, one worker, three runs at load under 8.
  # Same budgets as the desktop profile build with semantics off.
  # Fix-tied budgets are fixed. Calibrated gates use the slower client x 1.15,
  # rounded up to 100 ms, only after both clients have three valid runs.

  Scenario: Opening the dashboard cold
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And dashboard performance is being recorded
    When I open that dashboard with nothing cached
    Then the first widget showed data within 2500 ms
    And every visible widget completed within 6500 ms
    And every widget completed within 7500 ms
    And no frame stalled for more than 400 ms

  Scenario: Reopening the dashboard within a minute
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I open another page and return to the dashboard within 30 seconds
    Then every visible widget completed within 1200 ms
    And every widget completed within 4000 ms

  Scenario: The first reopen after a row was edited
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And I changed the Department of the first employee in the plain grid widget
    And dashboard performance is being recorded
    When I open another page and return to the dashboard within 30 seconds
    Then every visible widget completed within 2000 ms

  Scenario: Editing a cell reaches every widget that shows the row
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I change the Department of the first employee in the plain grid widget
    Then every widget that shows the row reflected the change within 1500 ms
    And each Department chart shows the change and changed exactly once

  Scenario: Scrolling the page and a grid widget
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I scroll the dashboard down and back up
    Then at most 2 percent of frames missed the frame budget
    And no frame stalled for more than 100 ms
    When I scroll the plain grid widget down 80 notches
    Then at most 5 percent of frames missed the frame budget

  Scenario: Moving the pointer across rows and over a chart
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I move the pointer across every dashboard row
    Then at most 5 percent of frames missed the frame budget
    And no frame stalled for more than 100 ms
    When I move the pointer across the bar chart
    Then at most 2 percent of frames missed the frame budget

  Scenario: Entering and leaving Edit mode
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I enter Edit mode
    Then the dashboard settled within 250 ms
    When I leave Edit mode
    Then the dashboard settled within 250 ms

  Scenario: Dragging the height and width handles of a row
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And I entered Edit mode
    And dashboard performance is being recorded
    When I drag the height handle of the first row down for 2 seconds
    Then at most 15 percent of frames missed the frame budget
    And no frame stalled for more than 100 ms
    When I drag the width handle between the first two widgets for 2 seconds
    Then at most 5 percent of frames missed the frame budget

  Scenario: Typing in a text global filter
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And the dashboard has a text global filter on Name
    And dashboard performance is being recorded
    When I type the letters a and n into the Name global filter one at a time, waiting for every widget after each
    Then for each letter every widget changed within 7000 ms
    And for each letter each widget changed at most 2 times
    And no frame stalled for more than 150 ms

  Scenario: Toggling a select global filter option
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And the dashboard has a select global filter on Department
    And dashboard performance is being recorded
    When I select Engineering in the Department global filter
    Then every widget changed within 1400 ms
    And each widget changed at most 2 times
    When I clear the Department global filter
    Then every widget changed within 1400 ms
    And each widget changed at most 2 times

  Scenario: Switching to the Grid tab and back
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And the employees database has a dashboard with 12 widgets showing its views in 4 rows of 3
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I open the Grid tab of the employees database and return to the dashboard tab
    Then every visible widget completed within 1500 ms
    And every widget completed within 3600 ms

  Scenario: Adding a widget of a source the dashboard already shows
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And I entered Edit mode
    And dashboard performance is being recorded
    When I add a widget showing the employees Grid view
    Then the new widget showed data within 700 ms

  Scenario: Leaving the dashboard
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    And dashboard performance is being recorded
    When I leave the dashboard
    Then no frame stalled for more than 150 ms

  Scenario: Three visits leave nothing behind
    Given the employees database is open
    And the employees database has 12 views for dashboard widgets
    And a new database has a dashboard with 12 widgets showing the employees views
    And I opened that dashboard and it finished loading
    When I leave and reopen the dashboard 3 times
    Then the memory after the third visit is within 10 percent of the memory after the first
    When I leave the dashboard and wait 75 seconds
    Then nothing of the dashboard is still in memory
