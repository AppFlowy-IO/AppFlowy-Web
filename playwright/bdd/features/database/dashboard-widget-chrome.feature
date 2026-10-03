@dashboard @cloud
Feature: Dashboard widget chrome
  Every widget is a padded box with a quiet title pill above its own card.
  Its tools appear on hover, and an active filter or sort stays visible.
  Edit mode only changes colors: a blue tint, a blue title, and always-visible
  tools. An open menu or settings panel outlines the widget.

  Scenario: A widget title is a quiet pill button above its own card
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the dashboard is in View mode
    And the "Grid" widget title is a "Widget options" button above the widget card
    And the "Grid" widget title shows no icon
    And the "Grid" widget header is 40 pixels tall
    And the "Grid" widget card is 46 pixels shorter than its row

  Scenario: Widget tools appear only while the widget is hovered
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I move the pointer away from the dashboard
    Then the "Grid" widget shows no tools
    When I hover the "Grid" widget
    Then the "Grid" widget shows the tools "Filter, Sort"
    And the "Board" widget shows no tools
    When I hover the "Board" widget
    Then the "Board" widget shows the tools "Filter"

  Scenario: An active widget filter keeps its highlighted icon visible without hover
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I filter the "Grid" widget by its checkbox property
    And I move the pointer away from the dashboard
    Then the "Grid" widget shows the tools "Filter"
    And the "Filter" tool of the "Grid" widget is highlighted

  Scenario: Widget filters open in a popover and never inside the card
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I filter the "Grid" widget by its checkbox property
    Then the "Grid" widget card shows no filter bar
    When I open the "Filter" tool of the "Grid" widget
    Then the widget "Filters" popover lists 1 rule
    When I press Escape
    Then the widget "Filters" popover is closed
    And the "Grid" widget card shows no filter bar

  Scenario: The widget title opens the widget menu from the keyboard and gets the focus back
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I focus the "Grid" widget title
    And I press Enter
    Then the widget menu is open
    When I press Escape
    Then the widget menu is closed
    And the "Grid" widget title has the keyboard focus

  Scenario: Clicking the title or right-clicking the widget opens its menu
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the "Grid" widget title
    Then the widget menu is open
    And the "Grid" widget is not outlined
    When I press Escape
    And I right-click the "Board" widget outside its title
    Then the widget menu is open

  Scenario: Edit mode tints the widgets and turns titles and tools blue without resizing them
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I remember the size of the "Grid" widget card
    And I click the dashboard Edit button
    Then the dashboard is in Edit mode
    And the "Grid" widget has the edit tint
    And the "Grid" widget title is blue
    And the "Grid" widget shows the tools "Filter, Sort, Settings" without hover
    And the "Grid" widget header has no drag glyph and no more button
    And the "Grid" widget card keeps its size

  Scenario: A widget is outlined while its menu or its settings are open in Edit mode
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I click the dashboard Edit button
    And I click the "Grid" widget title
    Then the "Grid" widget is outlined
    And the "Board" widget is not outlined
    When I press Escape
    Then the "Grid" widget is not outlined
    When I open the "Settings" tool of the "Grid" widget
    Then the "View settings" panel opens beside the "Grid" widget
    And the "Grid" widget is outlined
    When I close the "View settings" panel
    Then the "Grid" widget is not outlined

  Scenario: "Show icons in heading" adds the view icon to widget titles and is saved with the dashboard
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the "Grid" widget title shows no icon
    When I turn on the dashboard setting "Show icons in heading"
    Then the "Grid" widget title shows the view icon
    And the dashboard layout setting "show_icons_in_heading" is true
    When I reopen the dashboard
    Then the "Grid" widget title shows the view icon

  Scenario: With widget titles hidden, a floating "Widget options" button still opens the widget menu
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I turn off the dashboard setting "Show widget titles"
    Then the "Grid" widget has no title
    And the "Grid" widget card is 12 pixels shorter than its row
    When I hover the "Grid" widget
    And I click the "Widget options" button of the "Grid" widget
    Then the widget menu is open
    When I choose "open" in the widget menu
    Then the "Grid" view is open outside the dashboard

  Scenario: The dashboard toolbar orders Filter, Settings and a text-only Edit button
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the dashboard toolbar shows "Filter, Settings, Edit" from left to right
    And the dashboard Edit button shows no icon
    When I click the dashboard Edit button
    Then the dashboard toolbar shows "Filter, Settings, Done" from left to right

  Scenario: Widget tools keep their place when the widget is hovered
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    When I remember the size of the "Grid" widget card
    And I hover the "Grid" widget
    Then the "Grid" widget card keeps its size

  Scenario: A chart widget offers only Filter in View mode and Filter and Settings in Edit mode
    Given a dashboard of "Projects" shows its "Grid" and "Chart" views side by side
    When I hover the "Chart" widget
    Then the "Chart" widget shows the tools "Filter"
    When I click the dashboard Edit button
    Then the "Chart" widget shows the tools "Filter, Settings" without hover

  Scenario: Expanding a linked dashboard opens the dashboard itself as a full page
    Given a document links "Projects" as a dashboard
    Then the dashboard toolbar shows "Filter, Open as full page, Settings, Done" from left to right
    When I click "Open as full page" in the dashboard toolbar
    Then the "View of Projects" dashboard is open as a full page

  Scenario: A grid widget's table starts at the card's content inset with compact rows
    Given a dashboard of "Projects" shows its "Grid" and "Board" views side by side
    Then the first column of the "Grid" widget starts 32 pixels inside the widget card
    And the column headers of the "Grid" widget start at the top of the widget card
    And the "Grid" widget shows no row selection checkboxes
    And each one-line row of the "Grid" widget is 36 pixels tall plus a 1 pixel divider
    When I hover row 1 of the "Grid" widget
    Then row 1 of the "Grid" widget shows only its row menu button
    When I move the pointer away from the dashboard
    Then the "Grid" widget shows no scrollbar

  # The inset is dashboard-parity/widget-content.json geometry.list_title_inset
  # (the 40px row-actions slot, the 6px row padding and the 2px title inset).
  Scenario: A list widget's row titles start at the card's content inset
    Given a dashboard of "Projects" shows its "List" and "Board" views side by side
    Then the first row title of the "List" widget starts 48 pixels inside the widget card
    When I click the dashboard Edit button
    Then the first row title of the "List" widget starts 48 pixels inside the widget card

  @web-only
  Scenario: A widget whose source cannot load offline says it is available when back online
    Given the dashboard fixture workspace is ready
    And I added a dashboard to "Projects"
    And the dashboard has these widgets:
      | row | widget        |
      | 1   | Projects Grid |
      | 1   | Tasks Grid    |
    And the "Tasks" database cannot be reached and is not cached in this browser
    When I reload the dashboard
    Then the "Tasks Grid" widget shows the "offline" placeholder saying "Available when you're back online"
    And the "Projects Grid" widget shows the rows "Website launch, Mobile app, API cleanup"
    When the connection to the "Tasks" database comes back
    Then the "Tasks Grid" widget shows the rows "Write launch plan, Review, Ship"
