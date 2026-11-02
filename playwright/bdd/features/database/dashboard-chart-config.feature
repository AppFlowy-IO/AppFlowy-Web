@dashboard @cloud
Feature: Dashboard chart configuration and Number cards
  Chart widgets are configured in one View settings panel: a row of chart
  type icons, then X axis, Y axis and Style sections. Categories can be any
  common property, sorted, hidden and reordered. Number cards show their
  caption above the value and can be colored statically or by rules.

  Background:
    Given the dashboard fixture workspace is ready
    And "Projects" also has a "Chart" view

  Scenario: The chart settings show chart types as icons and name the axes by chart type
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    Then the chart settings show the chart types "Vertical bar, Horizontal bar, Line, Donut, Number"
    And the "Vertical bar" chart type is selected
    And the chart settings show the sections "Chart type, X axis, Y axis, Style"
    And the "X axis" chart settings section includes "What to show, Sort by, Groups"
    And the "Y axis" chart settings section includes "What to show, Cumulative"
    When I choose the "Horizontal bar" chart type
    Then the chart settings show the sections "Chart type, X axis, Y axis, Style"
    And the "X axis" chart settings section includes "What to show, Cumulative"
    And the "Y axis" chart settings section includes "What to show, Sort by, Groups"
    When I choose the "Donut" chart type
    Then the chart settings show the sections "Chart type, Data, Style"
    And the "Data" chart settings section includes "What to show, Each slice represents, Sort by, Groups"
    And the chart settings do not offer "Cumulative"

  Scenario: The field list is searchable
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I open "What to show" in the "X axis" chart settings section
    And I search the chart fields for "EST"
    Then the chart fields list only "Estimate"
    When I search the chart fields for "zzz"
    Then the chart fields say "No results"

  Scenario: Categories follow the option order and can be sorted by value or name
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I set the chart Y axis to "Estimate" with "Sum"
    Then the "Projects Chart" widget shows the categories in order "Todo, Doing, Done"
    When I sort the chart by "Value high → low"
    Then the "Projects Chart" widget shows the categories in order "Done, Todo, Doing"
    When I sort the chart by "Z → A"
    Then the "Projects Chart" widget shows the categories in order "Todo, Done, Doing"
    And the saved chart is sorted "label_desc"

  Scenario: Hidden groups leave the chart and dragging a group makes the order manual
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I open "Groups" in the "X axis" chart settings section
    And I hide the "Doing" chart group
    Then the "Projects Chart" widget shows the categories in order "Todo, Done"
    And the saved chart hides the groups "Doing"
    When I drag the "Done" chart group above "Todo"
    Then the "Projects Chart" widget shows the categories in order "Done, Todo"
    And the saved chart is sorted "manual"
    When I show all chart groups
    Then the "Projects Chart" widget shows the categories in order "Done, Todo, Doing"

  Scenario: Two options with the same name stay separate categories
    Given the "Status" property of "Projects" has a second option named "Doing"
    And "Mobile app" uses the second "Doing" option
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget draws 3 bars
    And the "Projects Chart" widget shows the categories in order "Doing, Done, Doing"

  Scenario: A text property groups by exact value or by first letter
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I set the chart X axis to "Name"
    Then the "Projects Chart" widget shows the categories in order "API cleanup, Mobile app, Website launch"
    When I group the chart text by "First letter"
    Then the "Projects Chart" widget shows the categories in order "A, M, W"

  Scenario: A number property groups into ranges
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I set the chart X axis to "Estimate"
    Then the "Projects Chart" widget shows the categories in order "3–3.5, 5–5.5, 8–8.5"
    When I set the chart range size to "5"
    Then the "Projects Chart" widget shows the categories in order "0–5, 5–10"
    And the "Projects Chart" widget shows the value "2" for "5–10"

  Scenario: The Number card shows its caption above the value and can hide it
    Given the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    Then the "Projects Chart" widget shows the caption "Count all" above the number "3"
    When I open the settings of the "Projects Chart" widget
    And I turn off the chart title
    Then the "Projects Chart" widget shows the number "3" without a caption
    And the saved chart does not show its title

  Scenario: The Number Calculate menu is grouped and offers property calculations
    Given the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I set the chart "What to show" to "Urgent"
    Then the "Projects Chart" widget shows the caption "Percent checked of Urgent" above the number "66.7%"
    When I open "Calculate" in the "Data" chart settings section
    Then the chart Calculate menu offers "Count: Count all, Count values, Count unique values, Count empty; Percent: Percent checked, Percent unchecked"
    When I choose "Count empty" in the chart settings
    Then the "Projects Chart" widget shows the number "1"
    When I set the chart "What to show" to "Due"
    And I choose the chart calculation "Date range"
    Then the "Projects Chart" widget shows the number "13 days"

  Scenario: A chart whose value property was deleted counts rows
    Given the "Projects" chart is a Number chart using "Sum" of "Estimate"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    Then the "Projects Chart" widget shows the number "16"
    When the "Estimate" property of "Projects" is deleted
    Then the "Projects Chart" widget shows the caption "Count all" above the number "3"

  Scenario: A Number chart over no rows shows No data without a caption
    Given the fixture also has the "Backlog" database
    And "Backlog" also has a "Chart" view
    And the "Backlog" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Backlog Chart |
    Then the "Backlog Chart" widget shows no data

  Scenario: The Number value takes a static color or the first matching dynamic rule
    Given the "Projects" chart is a Number chart using "Count"
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget         |
      | 1   | Projects Chart |
    And the dashboard is in Edit mode
    When I open the settings of the "Projects Chart" widget
    And I pick the "Blue" number color
    Then the "Projects Chart" number is shown in "blue"
    When I turn on dynamic color
    And I set dynamic color rule 1 to "Greater than" "5" in "Green"
    And I add a dynamic color rule "Less than" "2" in "Red"
    Then the "Projects Chart" number is shown in "blue"
    When I set the dynamic color else to "Orange"
    Then the "Projects Chart" number is shown in "orange"
    When I set dynamic color rule 1 to "Greater than" "2" in "Green"
    Then the "Projects Chart" number is shown in "green"
    And the saved chart has 2 dynamic color rules
