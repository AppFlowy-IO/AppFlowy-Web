@dashboard @cloud
Feature: Dashboard widget integration
  Every database layout keeps its own interactions inside a widget: timelines
  plot bars, calendars navigate, charts drill down and tables open rows,
  without leaving the dashboard.

  Background:
    Given the dashboard fixture workspace is ready

  Scenario: A timeline widget plots its rows as bars
    Given "Projects" also has a "Timeline" view
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget            |
      | 1   | Projects Timeline |
    Then the "Projects Timeline" widget shows 3 timeline bars

  Scenario: A calendar widget navigates months in place
    Given "Tasks" also has a "Calendar" view
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Tasks Calendar |
    When I step the "Tasks Calendar" widget to the next month
    Then the "Tasks Calendar" widget title shows next month
    When I click Today in the "Tasks Calendar" widget
    Then the "Tasks Calendar" widget title shows the current month
    And the dashboard view is still open

  Scenario: Clicking a chart widget bar drills down into its rows
    Given "Projects" also has a "Chart" view
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    When I click the first bar of the "Projects Chart" widget
    Then a drill-down lists exactly one of "Website launch, Mobile app, API cleanup"

  Scenario: A table widget opens a row page
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
    When I open the "Website launch" row from the "Projects Grid" widget
    Then the row page for "Website launch" is open
    When I close the row page
    Then the dashboard view is still open
