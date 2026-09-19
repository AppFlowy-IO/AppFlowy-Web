@dashboard @cloud
Feature: Number chart widgets
  The Number chart type renders one big aggregated value, which makes it the
  natural KPI tile of a dashboard. It counts rows or aggregates a number
  property and follows the dashboard's global filters.

  Background:
    Given the dashboard fixture workspace is ready
    And "Projects" also has a "Chart" view

  Scenario: A Number chart counts all rows
    Given the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget shows the number "3"
    And the "Projects Chart" widget shows a number chart title

  Scenario: A Number chart sums a number property
    Given the "Projects" chart is a Number chart using "Sum" of "Estimate"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget shows the number "16"

  Scenario: A Number chart averages a number property
    Given the "Projects" chart is a Number chart using "Average" of "Estimate"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget shows a number starting with "5.3"

  Scenario: A Number chart over an empty database shows nothing to count
    Given the fixture also has the "Backlog" database
    And "Backlog" also has a "Chart" view
    And the "Backlog" chart is a Number chart using "Count"
    And the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Backlog Chart  |
      | 1   | Projects Chart |
    Then the "Backlog Chart" widget shows an empty number chart
    And the "Projects Chart" widget shows a number chart

  Scenario: A Number chart follows the dashboard's global filters
    Given the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    When the dashboard has a saved "Status" filter for "Doing, Done" mapped to "Status" in "Projects"
    Then the "Projects Chart" widget shows the number "2"
    When I open the "Status" global filter
    And I delete the open global filter
    Then the "Projects Chart" widget shows the number "3"
