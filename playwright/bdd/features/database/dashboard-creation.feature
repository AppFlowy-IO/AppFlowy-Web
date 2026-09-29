@dashboard @cloud
Feature: Dashboard view creation
  A Dashboard is a database view whose content is a grid of widgets, each one
  rendering another database view. It is created from the view tab "+" menu or
  by switching an existing view's layout, starts empty in Edit mode, and owns
  none of the views its widgets show.

  Background:
    Given the dashboard fixture workspace is ready

  Scenario: The view tab menu adds an empty dashboard named Dashboard in Edit mode
    When I add a dashboard to "Projects" from the view tab menu
    Then the dashboard is in Edit mode
    And the dashboard shows its empty state with an Add widget button
    And the active dashboard tab is named "Dashboard"
    And the dashboard layout setting exists with 0 widgets

  Scenario: The dashboard tab shows the dashboard icon and the sidebar lists the dashboard
    When I add a dashboard to "Projects" from the view tab menu
    Then the dashboard view tab shows the dashboard icon
    And the dashboard is listed in the sidebar under its database

  Scenario: The layout switcher turns an existing view into a dashboard
    Given "Projects" also has a "Board" view
    When I switch the "Projects Board" view to the Dashboard layout
    Then the dashboard view is shown
    And the dashboard layout setting exists with 0 widgets
    And the dashboard view tab shows the dashboard icon

  Scenario: An empty dashboard in View mode tells viewers it has no widgets
    When I add a dashboard to "Projects" from the view tab menu
    And I click the dashboard Done button
    Then the dashboard is in View mode
    And the dashboard empty state reads "This dashboard has no widgets yet."

  Scenario: Deleting the dashboard keeps the views its widgets showed
    Given I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
    When I delete the dashboard view tab
    Then the dashboard view tab is gone
    And the "Projects Grid" view still shows 3 rows
    And the "Tasks Grid" view still shows 3 rows
