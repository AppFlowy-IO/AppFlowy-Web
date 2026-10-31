@dashboard @cloud @mobile
Feature: Dashboards on a phone are view-only
  On a phone a dashboard can be read, filtered, searched and drilled into,
  but not rearranged. Widgets stack one per line, their Search and Filter
  tools are always visible, and menus, filters and drill-downs open as
  bottom sheets.

  Scenario: A phone shows the dashboard in View mode without editing controls
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    Then the dashboard is in View mode
    And the dashboard offers no Edit button
    And the dashboard shows no add, move or resize controls
    And the dashboard toolbar shows only the Filter button
    And the "Grid" widget is above the "Board" widget at full width

  Scenario: A phone shows a full dashboard one widget per line without add controls
    Given a phone shows a dashboard of "Projects" with 12 widgets in rows of "4, 4, 4"
    Then the dashboard is in View mode
    And the dashboard offers no Edit button
    And the dashboard shows 12 widgets one per line at full width
    And the dashboard shows no add, move or resize controls

  Scenario: Widgets on a phone always show Search and Filter
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    Then the "Grid" widget shows the tools "Search, Filter" without hover
    And the "Board" widget shows the tools "Search, Filter" without hover

  Scenario: A widget filter on a phone opens in a bottom sheet and stays private
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    When I tap the "Filter" tool of the "Grid" widget
    Then a bottom sheet titled "Filter" is open
    When I filter by the checkbox property "Urgent" in the bottom sheet
    And I close the bottom sheet
    Then the "Grid" widget shows the rows "Website launch, API cleanup"
    And the "Filter" tool of the "Grid" widget is highlighted
    And the "Grid" view has 0 saved filters

  Scenario: Searching a widget on a phone
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    When I tap the "Search" tool of the "Grid" widget
    And I type "launch" into the search field of the "Grid" widget
    Then the "Grid" widget shows the rows "Website launch"
    And the "Grid" widget title is replaced by its search field
    When I clear the search field of the "Grid" widget
    Then the "Grid" widget shows the rows "Website launch, Mobile app, API cleanup"

  Scenario: The widget title opens a bottom sheet that only offers View data source
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    When I tap the "Grid" widget title
    Then a bottom sheet offers only "View data source"
    When I close the bottom sheet
    And I long-press the "Board" widget title
    Then a bottom sheet offers only "View data source"
    When I choose "View data source" in the bottom sheet
    Then the "Board" view of "Projects" opens full screen

  Scenario: Global filters work on a phone and stay private until saved
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    And the dashboard has a saved global filter where "Status" is "Doing"
    When I tap the "Status" global filter pill
    Then a bottom sheet shows the "Status" global filter
    When I also select "Done" in the bottom sheet
    And I close the bottom sheet
    Then the "Status" global filter pill shows the unsaved dot
    And the "Grid" widget shows the rows "Website launch, API cleanup"
    And the saved "Status" global filter still matches only "Doing"

  Scenario: A chart drill-down on a phone opens a full-height bottom sheet
    Given a phone shows a dashboard of "Projects" with its "Status" bar chart
    When I tap the "Doing" bar of the "Status" widget
    Then the chart tooltip shows "Doing"
    When I tap the "Doing" bar of the "Status" widget again
    Then a full-height bottom sheet titled "Doing" is open
    And the bottom sheet shows the filter chip "Status: Doing"
    And the bottom sheet lists the rows "Website launch"
    When I tap the row "Website launch" in the bottom sheet
    Then the row "Website launch" opens full screen

  Scenario: Dashboard is not offered when adding a view on a phone
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    When I open the view list
    And I start adding a view
    Then the layout list does not offer "Dashboard"

  Scenario: A tablet-width screen keeps two widgets side by side and stays view-only
    Given a phone shows a dashboard of "Projects" with its "Grid" and "Board" views side by side
    When the screen is 600 pixels wide
    Then the widgets of dashboard row 1 are side by side
    And the dashboard offers no Edit button

  @cloud
  Scenario: A read-only member filters a dashboard on a phone
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    And the dashboard has a saved global filter where "Status" is "Doing"
    And a read-only member opens the dashboard on a phone
    Then the member sees the dashboard in View mode without the Edit button
    When the member also selects "Done" in the "Status" global filter pill
    Then the member sees the "Grid" widget show the rows "Website launch, API cleanup"
    And the member sees no Save for everyone button
