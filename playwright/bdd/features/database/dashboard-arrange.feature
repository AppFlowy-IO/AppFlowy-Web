@dashboard @cloud
Feature: Dashboard arranging

  Scenario: The row move control offers only the moves a row can make
    Given a dashboard seeded with rows of {'1, 1, 1'} widgets is open in edit mode
    When the user hovers dashboard row {1}
    Then dashboard row {1} offers the row moves {'down'}
    When the user hovers dashboard row {2}
    Then dashboard row {2} offers the row moves {'up, down'}
    When the user hovers dashboard row {3}
    Then dashboard row {3} offers the row moves {'up'}

  Scenario: A dashboard with one row shows no row move control
    Given a dashboard seeded with rows of {'2'} widgets is open in edit mode
    When the user hovers dashboard row {1}
    Then dashboard row {1} offers no row moves
    And dashboard row {1} offers the add to row button

  Scenario: Moving a row down swaps it with the next row in one undo step
    Given a dashboard seeded with row widths {'8 4; 12'} is open in edit mode
    When the user moves dashboard row {1} down
    Then the dashboard row {1} has widget ids {'w:3'}
    And the dashboard row {2} has widget ids {'w:1, w:2'}
    And the dashboard row {2} has widths {'8, 4'}
    When the user presses undo on the dashboard
    Then the dashboard row {1} has widget ids {'w:1, w:2'}
    When the user presses redo on the dashboard
    Then the dashboard row {1} has widget ids {'w:3'}

  Scenario: The row move buttons work from the keyboard and keep focus
    Given a dashboard seeded with rows of {'1, 1, 1'} widgets is open in edit mode
    When the user focuses the move down button of dashboard row {2}
    And the user presses the Enter key
    Then the dashboard row {3} has widget ids {'w:2'}
    And the move up button of dashboard row {3} has focus

  Scenario: Row controls appear only on the hovered row in Edit mode
    Given a dashboard seeded with rows of {'1, 1'} widgets is open in edit mode
    When the user hovers dashboard row {1}
    Then the row controls of dashboard row {1} are visible
    And the row controls of dashboard row {2} are hidden
    And the add to new row button is visible
    When the user leaves dashboard edit mode
    Then the dashboard shows no row controls

  Scenario: Adding a widget to a row splits the row equally
    Given a dashboard seeded with row widths {'8 4'} is open in edit mode
    When the user adds a widget to dashboard row {1} from the picker view {'Grid'}
    Then the dashboard row {1} has widths {'4, 4, 4'}

  Scenario: Deleting a widget splits the rest of its row equally
    Given a dashboard seeded with row widths {'6 3 3'} is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'delete'} in the dashboard widget menu
    Then the dashboard row {1} has widget ids {'w:1, w:3'}
    And the dashboard row {1} has widths {'6, 6'}

  Scenario: Dragging a widget into another row splits both rows equally
    Given a dashboard seeded with row widths {'6 3 3; 8 4'} is open in edit mode
    When the user drags dashboard widget {1} onto the right side of dashboard widget {5}
    Then the dashboard row {1} has widths {'6, 6'}
    And the dashboard row {2} has widget ids {'w:4, w:5, w:1'}
    And the dashboard row {2} has widths {'4, 4, 4'}

  Scenario: Moving a widget left keeps every width in its row
    Given a dashboard seeded with row widths {'8 4'} is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'move-left'} in the dashboard widget menu
    Then the dashboard row {1} has widget ids {'w:2, w:1'}
    And the dashboard row {1} has widths {'4, 8'}

  Scenario: The widget menu follows Notion in Edit mode
    Given a dashboard seeded with rows of {'3'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {2}
    Then the dashboard widget menu offers only {'edit-view, move-left, move-right, move-to-row, duplicate, delete'}

  Scenario: The widget menu hides the move that has no target
    Given a dashboard seeded with rows of {'3'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {1}
    Then the dashboard widget menu offers only {'edit-view, move-right, move-to-row, duplicate, delete'}

  Scenario: Create new row below moves the widget into its own row and re-splits its old row
    Given a dashboard seeded with rows of {'3, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'create-row-below'} in the dashboard widget menu
    Then the dashboard has {3} rows
    And the dashboard row {1} has widget ids {'w:1, w:3'}
    And the dashboard row {1} has widths {'6, 6'}
    And the dashboard row {2} has widget ids {'w:2'}
    And the dashboard row {2} has widths {'12'}
    And the dashboard row {3} has widget ids {'w:4'}

  Scenario: Create new row above inserts the widget's new row above its old row
    Given a dashboard seeded with rows of {'2, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {2}
    And the user chooses {'create-row-above'} in the dashboard widget menu
    Then the dashboard row {1} has widget ids {'w:2'}
    And the dashboard row {2} has widget ids {'w:1'}
    And the dashboard row {2} has widths {'12'}

  Scenario: A widget alone in its row cannot create a new row
    Given a dashboard seeded with rows of {'2, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {3}
    And the user opens the move to row submenu
    Then the move to row options {'create-row-above, create-row-below'} are disabled

  Scenario: In View mode the widget menu only offers View data source
    Given a dashboard seeded with rows of {'1'} widgets is open in edit mode
    When the user leaves dashboard edit mode
    And the user opens the menu of dashboard widget {1}
    Then the dashboard widget menu offers only {'view-data-source'}
    When the user chooses {'view-data-source'} in the dashboard widget menu
    Then the view {'Grid'} of the database {'Projects'} is open outside the dashboard

  Scenario: A full dashboard disables Duplicate and the add buttons with the Dashboard is full tooltip
    Given a dashboard seeded with rows of {'4, 4, 3, 1'} widgets is open in edit mode
    When the user opens the menu of dashboard widget {1}
    Then the dashboard widget menu item {'duplicate'} is disabled
    When the user hovers the dashboard widget menu item {'duplicate'}
    Then the dashboard full tooltip is shown
    When the user dismisses the dashboard widget menu
    And the user hovers dashboard row {1}
    Then dashboard row {1} offers no add to row button
    When the user hovers dashboard row {3}
    Then dashboard row {3} offers a disabled add to row button
    When the user hovers the add to new row button
    Then the add to new row button is disabled
    And the dashboard full tooltip is shown
    When the user clicks the add to new row button
    Then the dashboard has {12} widgets
    And the dashboard shows no limit banner

  Scenario: A full row hides its add button and refuses a dragged widget without a banner
    Given a dashboard seeded with rows of {'4, 1'} widgets is open in edit mode
    When the user hovers dashboard row {1}
    Then dashboard row {1} offers no add to row button
    When the user hovers dashboard row {2}
    Then dashboard row {2} offers the add to row button
    When the user starts dragging dashboard widget {5} over the left side of dashboard widget {1}
    Then the dashboard shows no drop indicator
    When the user drops the dragged widget
    Then the dashboard row {1} has widget ids {'w:1, w:2, w:3, w:4'}
    And the dashboard row {2} has widget ids {'w:5'}
    And the dashboard shows no limit banner

  Scenario: Dropping a lone widget next to its own row changes nothing
    Given a dashboard seeded with rows of {'2, 1'} widgets is open in edit mode
    When the user drags dashboard widget {3} into dashboard row gap {1}
    Then the dashboard layout is unchanged
    When the user drags dashboard widget {3} into dashboard row gap {2}
    Then the dashboard layout is unchanged

  Scenario: Dragging shows a ghost, fades the source and draws accent drop lines
    Given a dashboard seeded with rows of {'3, 1'} widgets is open in edit mode
    When the user starts dragging dashboard widget {1} over the right side of dashboard widget {2}
    Then the dashboard shows the drag ghost of dashboard widget {1}
    And dashboard widget {1} is faded
    And the dashboard shows a vertical drop indicator in dashboard row {1}
    When the user moves the dragged widget into dashboard row gap {1}
    Then the dashboard shows a horizontal drop indicator in dashboard row gap {1}
    When the user drops the dragged widget
    Then the dashboard has {3} rows
    And the dashboard row {1} has widths {'6, 6'}
    And the dashboard row {2} has widget ids {'w:1'}
