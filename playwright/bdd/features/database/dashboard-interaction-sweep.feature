@dashboard @cloud
Feature: Every dashboard control opens without a framework error
  # The feature text and the steps are the same as desktop
  # integration_test/desktop/bdd/database/dashboard/dashboard_interaction_sweep.feature
  # (fix pass section 6.1). Only these comments and the tags differ, and
  # desktop steps write a parameter as {'Grid'} where web writes "Grid".
  #
  # A user opened a widget's View settings and the desktop app failed with a
  # missing provider. The sweep opens every control of every widget type, in
  # View and Edit mode, and fails at once on a framework error or warning:
  # on web a console error, a React warning ("Warning: ..."), an uncaught
  # exception or an unhandled promise rejection (dashboard-error-collector.ts).
  # The failure names the widget, the mode and the control that was open.
  #
  # The tools a widget offers come from dashboard-parity/widget-tools.json.
  # Nothing in the sweep changes persisted state: a control that would write
  # (the Source row's picker) is opened and cancelled, and every step checks
  # the dashboard layout and the widget's view are unchanged.

  Background:
    Given a dashboard of "Projects" shows a widget of every type
    And framework errors and warnings are being recorded

  Scenario: Every control of every widget opens in View mode without an error
    Then the dashboard is in View mode
    When I open and close every control of the "Grid" widget
    And I open and close every control of the "Board" widget
    And I open and close every control of the "List" widget
    And I open and close every control of the "Calendar" widget
    And I open and close every control of the "Bar chart" widget
    And I open and close every control of the "Line chart" widget
    And I open and close every control of the "Donut chart" widget
    And I open and close every control of the "Number chart" widget
    And I open and close every dashboard toolbar control
    Then no framework error or warning was reported

  Scenario: Every control of every widget opens in Edit mode without an error
    When I click the dashboard Edit button
    Then the dashboard is in Edit mode
    When I open and close every control of the "Grid" widget
    And I open and close every control of the "Board" widget
    And I open and close every control of the "List" widget
    And I open and close every control of the "Calendar" widget
    And I open and close every control of the "Bar chart" widget
    And I open and close every control of the "Line chart" widget
    And I open and close every control of the "Donut chart" widget
    And I open and close every control of the "Number chart" widget
    And I open and close every dashboard toolbar control
    And I open and close the widget picker
    Then no framework error or warning was reported

  Scenario: The View settings panel of every widget type opens each of its rows
    When I click the dashboard Edit button
    And I open the "Settings" tool of the "Grid" widget
    Then the "View settings" panel opens beside the "Grid" widget
    When I open every row of the "View settings" panel
    And I close the "View settings" panel
    And I open the "Settings" tool of the "Board" widget
    Then the "View settings" panel opens beside the "Board" widget
    When I open every row of the "View settings" panel
    And I close the "View settings" panel
    And I open the "Settings" tool of the "List" widget
    Then the "View settings" panel opens beside the "List" widget
    When I open every row of the "View settings" panel
    And I close the "View settings" panel
    And I open the "Settings" tool of the "Calendar" widget
    Then the "View settings" panel opens beside the "Calendar" widget
    When I open every row of the "View settings" panel
    And I close the "View settings" panel
    And I open the "Settings" tool of the "Bar chart" widget
    Then the "View settings" panel opens beside the "Bar chart" widget
    When I open every row of the "View settings" panel
    And I close the "View settings" panel
    Then no framework error or warning was reported
