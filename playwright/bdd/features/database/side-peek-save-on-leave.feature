Feature: Database side peek saves edits before leaving a row

  Leaving a peeked row by the header buttons, the Cmd/Ctrl+Shift+P/N
  shortcuts or the close button has to commit whatever the user left in the
  row: a property editor that is still focused, and values chosen in the
  select and date popovers. A draft that cannot be saved keeps the row open,
  reports why, and holds the one side slot of the page against another
  database until it is corrected.

  # Property editors commit on blur. Header controls and shortcuts leave focus
  # in the property, so the row handoff itself has to commit the edit.
  Scenario: A focused text property is saved when the side peek leaves the row
    Given I am signed in for side peek testing
    And I have created a grid named "Peek focused property" with rows "Amber, Birch, Cedar"
    And the grid has a text property named "Notes"
    When I open the row "Amber" in the peek from the grid
    And I type "kept by button" into the "Notes" text property of the peek without leaving it
    And I navigate to the next row with the button
    Then the peek shows the title "Birch"
    When I type "kept by shortcut" into the "Notes" text property of the peek without leaving it
    And I navigate to the previous row with the shortcut
    Then the peek shows the title "Amber"
    And the "Notes" property in the peek shows "kept by button"
    When I navigate to the next row with the button
    Then the peek shows the title "Birch"
    And the "Notes" property in the peek shows "kept by shortcut"
    When I navigate to the next row with the button
    Then the peek shows the title "Cedar"
    When I type "kept on close" into the "Notes" text property of the peek without leaving it
    And I close the peek with the close button
    Then no peek is open
    And the grid cell "Notes" of row "Cedar" contains "kept on close"
    When I reload the database page
    Then the grid cell "Notes" of row "Amber" contains "kept by button"
    And the grid cell "Notes" of row "Birch" contains "kept by shortcut"
    And the grid cell "Notes" of row "Cedar" contains "kept on close"

  # Popover editors write through their own cell path, not the focused-property
  # commit. Their menus own the shortcuts while open, so each is dismissed
  # first; the handoff must then neither drop nor outrun the write.
  Scenario: A select option chosen in the side peek survives navigation and close
    Given I am signed in for side peek testing
    And I have created a grid named "Peek select option" with rows "Amber, Birch, Cedar"
    And the grid has a select property named "Tier" with options "VIP, Basic"
    When I open the row "Amber" in the peek from the grid
    And I choose the option "VIP" for the "Tier" property in the peek
    And I navigate to the next row with the shortcut
    Then the peek shows the title "Birch"
    When I navigate to the previous row with the button
    Then the peek shows the title "Amber"
    And the "Tier" property in the peek shows "VIP"
    When I close the peek with the close button
    Then no peek is open
    And the grid cell "Tier" of row "Amber" contains "VIP"
    When I reload the database page
    Then the grid cell "Tier" of row "Amber" contains "VIP"

  Scenario: A date chosen in the side peek survives navigation and close
    Given I am signed in for side peek testing
    And I have created a grid named "Peek date" with rows "Amber, Birch, Cedar"
    And the grid has a date property named "Due"
    When I open the row "Amber" in the peek from the grid
    And I choose the date "03/14/2026" for the "Due" property in the peek
    And I navigate to the next row with the shortcut
    Then the peek shows the title "Birch"
    When I navigate to the previous row with the button
    Then the peek shows the title "Amber"
    And the "Due" property in the peek shows "03/14/2026"
    When I close the peek with the close button
    Then no peek is open
    And the grid cell "Due" of row "Amber" contains "03/14/2026"
    When I reload the database page
    Then the grid cell "Due" of row "Amber" contains "03/14/2026"

  # The title saves as it is typed, so the rejection shows at once; every way
  # of leaving the row is then refused while the draft is still too long.
  Scenario: An oversized title keeps the peek open until it is corrected
    Given I am signed in for side peek testing
    And I have created a grid named "Peek oversized title" with rows "Amber, Birch, Cedar"
    When I open the row "Birch" in the peek from the grid
    And I replace the peek title with 10001 characters
    Then the title is rejected as too long to save
    When I try to close the peek with the close button
    Then the peek stays open showing the 10001 character title
    When I try to navigate to the next row with the button
    Then the peek stays open showing the 10001 character title
    When I try to navigate to the previous row with the shortcut
    Then the peek stays open showing the 10001 character title
    And the visible rows are "Amber, Birch, Cedar"
    When I set the peek title to "Corrected title"
    And I close the peek with the close button
    Then no peek is open
    When I reload the database page
    Then the visible rows are "Amber, Corrected title, Cedar"
    When I open the row "Corrected title" in the peek from the grid
    Then the peek shows the title "Corrected title"

  # One side slot per page: a row opened from another linked grid asks the
  # open peek to save first, and is refused while its title cannot be saved.
  Scenario: A second database on the page cannot take the side peek while the title is invalid
    Given I am signed in for side peek testing
    And I have created a grid named "Peek first grid" with rows "Amber, Birch, Cedar"
    And I have created a grid named "Peek second grid" with rows "Delta, Echo, Foxtrot"
    And I have created a document named "Peek two grids" with a linked grid "Peek first grid"
    And the document also links the grid "Peek second grid"
    When I open the row "Amber" in the peek from the linked grid
    Then the peek is open in side mode showing "Amber"
    When I replace the peek title with 10001 characters
    Then the title is rejected as too long to save
    When I try to open the row "Delta" in the peek from the linked grid
    Then the peek stays open showing the 10001 character title
    When I set the peek title to "Corrected title"
    And I open the row "Delta" in the peek from the linked grid
    Then the peek is open in side mode showing "Delta"
    And the linked grid shows a row titled "Corrected title"
    When I close the peek with the close button
    Then no peek is open
    When I reload the document page
    Then the linked grid shows a row titled "Corrected title"
    When I open the row "Corrected title" in the peek from the linked grid
    Then the peek shows the title "Corrected title"
