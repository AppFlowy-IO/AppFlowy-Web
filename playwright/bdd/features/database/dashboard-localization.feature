@dashboard @cloud
Feature: Dashboards follow the app language
  Dashboard and chart labels, chart dates and compact numbers use the
  language chosen for the app.

  Scenario: Dashboard controls are translated
    Given the app language is "zh-CN"
    And a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the dashboard Edit button reads the "zh-CN" text for "Edit"
    When I click the dashboard Edit button
    Then the dashboard Done button reads the "zh-CN" text for "Done"
    When I click the "Grid" widget title
    Then the widget menu reads the "zh-CN" texts for "Edit view, Move right, Move to row, Duplicate, Delete"

  Scenario: Chart dates and compact numbers follow the app language
    Given the app language is "ja-JP"
    And a dashboard of "Budget" shows its "Monthly" bar chart and its "Total" number chart
    Then the "Monthly" widget shows the axis labels "2026年1月, 2026年2月"
    And the "Total" widget shows the number "7850万"
    When I change the app language to "en-US"
    Then the "Monthly" widget shows the axis labels "Jan 2026, Feb 2026"
    And the "Total" widget shows the number "78.5M"

  Scenario: Compact numbers and dates in Chinese
    Given the app language is "zh-CN"
    And a dashboard of "Budget" shows its "Monthly" bar chart and its "Total" number chart
    Then the "Total" widget shows the number "7850万"
    And the "Monthly" widget shows the axis labels "2026年1月, 2026年2月"
