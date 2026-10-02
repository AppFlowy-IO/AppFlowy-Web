@dashboard @cloud
Feature: Dashboard-owned widget views
  Views created for widgets belong to their dashboard: they are not database
  tabs, duplicates copy them with numbered names, the widget renames them, and
  deleting a widget removes the view it owned once editing is done.

  Scenario: The active tab is scrolled into view when the database opens
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And "Projects" has 12 more "Grid" views before the dashboard tab
    When the user reopens the "Projects" database on the dashboard tab
    Then the active tab is fully visible in the tab bar

  Scenario: Converting a view to a dashboard keeps it as the first widget
    Given a "Projects" database with a "Grid" view and an empty dashboard in Edit mode
    And "Projects" has a "Board" view named "Pipeline"
    When the user switches the "Pipeline" view of "Projects" to the Dashboard layout
    Then the dashboard has 1 widget
    And dashboard row 1 has widths "12"
    And dashboard row 1 is 360 pixels tall
    And widget 1 is titled "Pipeline"
    And widget 1 shows a "Board" view with the groups of the original "Pipeline" view
    And the view of widget 1 belongs to the dashboard
    And the "Projects" tab bar shows "Pipeline" with the dashboard icon
