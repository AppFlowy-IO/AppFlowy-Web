@dashboard @cloud
Feature: Dashboard settings from other app versions
  Every AppFlowy client edits the same dashboard. A client keeps the settings it
  does not understand when it saves its own changes, reads a missing setting as
  its default, and applies the same layout limits, so an older and a newer app
  can share one dashboard.

  Scenario: Moving a widget keeps dashboard settings from a newer app version
    Given a dashboard with two widgets in one row
    And the dashboard layout holds settings from a newer app version
    When the first widget is moved to the right through its menu in Edit mode
    Then the two widgets have swapped places
    And the dashboard layout still holds the settings from the newer app version

  Scenario: Changing a global filter keeps its settings from a newer app version
    Given a dashboard with two widgets in one row
    And the dashboard has a checkbox global filter from a newer app version
    When the checkbox global filter is changed to checked in Edit mode
    Then the checkbox global filter is saved as checked
    And the checkbox global filter still holds the settings from the newer app version

  Scenario: Changing the chart type keeps chart settings from a newer app version
    Given a dashboard with a chart widget
    And the chart holds settings from a newer app version
    When the chart widget is changed to a donut chart in Edit mode
    Then the chart is saved as a donut chart
    And the chart still holds the settings from the newer app version

  Scenario: Row heights follow the shared layout limits
    Given a dashboard with two widgets in one row
    When a widget is added in a new row below the last row in Edit mode
    Then the new row has the default row height
    When the new row is resized well below the minimum height
    Then the new row has the minimum row height
