@dockable_outline
Feature: Dockable document outline
  Full documents have floating heading navigation without reducing the content width.

  Scenario Outline: Short documents do not have a floating outline
    Given a dockable outline document with <count> headings is open
    Then the dockable outline is absent

    Examples:
      | count |
      | 0     |
      | 1     |
      | 2     |

  Scenario: Heading edits update the outline and enforce the three-heading threshold
    Given a dockable outline document with 2 headings is open
    Then the dockable outline is absent
    When I append outline document heading "Added section"
    Then the dockable outline is collapsed
    When I remember the outline article layout
    And I hover the dockable outline indicator
    Then the dockable outline contains 3 headings
    And dockable outline heading "Added section" is listed
    And the outline article layout and scroll position are unchanged
    When I rename outline document heading "Added section" to "Renamed section"
    And I hover the dockable outline indicator
    Then dockable outline heading "Renamed section" is listed
    And dockable outline heading "Added section" is not listed
    When I turn outline document heading "Renamed section" into a paragraph
    Then the dockable outline is absent

  Scenario: Outline item names update live when their mapped headings are renamed
    Given a compact dockable outline document with 3 headings is open
    When I move to the end of the outline document
    And I open the slash menu
    And I select slash command "outline"
    And I hover the dockable outline indicator
    Then both outlines list heading "Section 2"
    When I change mapped heading "Section 2" to "Updated & renamed section" while the outline is open
    Then the dockable outline is expanded
    And both outlines list heading "Updated & renamed section"
    And dockable outline heading "Section 2" is not listed
    And the dockable outline contains 3 headings
    And dockable outline heading "Section 1" is listed
    And dockable outline heading "Section 3" is listed
    When I click dockable outline heading "Updated & renamed section"
    Then the outline link still targets the renamed heading
    When I change mapped heading "Updated & renamed section" to "Final section name" while the outline is open
    Then the dockable outline is expanded
    And both outlines list heading "Final section name"
    And dockable outline heading "Updated & renamed section" is not listed
    And the dockable outline contains 3 headings
    When I click dockable outline heading "Final section name"
    Then the outline link still targets the renamed heading

  Scenario Outline: Table of contents keeps its outline search aliases
    Given a compact dockable outline document with 3 headings is open
    When I move to the end of the outline document
    And I open the slash menu
    And I search the slash menu for "<query>"
    Then the outline slash command is labeled "Table of contents"
    When I select slash command "outline"
    And I hover the dockable outline indicator
    Then both outline titles are "Table of contents"
    And the dockable outline contains 3 headings
    And the inline outline contains 3 headings

    Examples:
      | query             |
      | Outline           |
      | Out               |
      | Table of contents |

  Scenario Outline: Outline colors update live when the inline outline block color changes
    Given a compact dockable outline document with 3 headings is open
    And the dockable outline uses the "<theme>" theme
    When I move to the end of the outline document
    And I open the slash menu
    And I select slash command "outline"
    And I hover the dockable outline indicator
    And I move the pointer to the dockable outline header
    Then both outlines use the "default" color
    And the active dockable outline item has the "default" selected background
    When I change the inline outline color to "purple" while the dockable outline is open
    Then the dockable outline is expanded
    And both outlines use the "purple" color
    And the active dockable outline item has the "purple" selected background
    When I hover dockable outline heading "Section 2"
    Then dockable outline heading "Section 2" has the "purple" hover background
    When I move the pointer to the dockable outline header
    And I change the inline outline color to "green" while the dockable outline is open
    Then the dockable outline is expanded
    And both outlines use the "green" color
    And the active dockable outline item has the "green" selected background
    When I hover dockable outline heading "Section 2"
    Then dockable outline heading "Section 2" has the "green" hover background
    When I move the pointer to the dockable outline header
    And I change the inline outline color to "default" while the dockable outline is open
    Then the dockable outline is expanded
    And both outlines use the "default" color
    And the active dockable outline item has the "default" selected background
    When I hover dockable outline heading "Section 2"
    Then dockable outline heading "Section 2" has the "default" hover background
    And the dockable outline contains 3 headings
    And the inline outline contains 3 headings

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: Hover, delayed closing, navigation, and scroll tracking
    Given a dockable outline document with 6 headings is open
    Then the dockable outline is collapsed
    When I hover the dockable outline indicator
    Then the dockable outline is expanded
    And the dockable outline contains 6 headings
    And the editable dockable outline has no display settings
    When I briefly leave and reenter the dockable outline
    Then the dockable outline is expanded
    When I click dockable outline heading "Section 3"
    Then the document is at outline heading "Section 3"
    And the dockable outline is expanded
    When I move the pointer to the dockable outline header
    Then the active dockable outline item has the "default" selected background
    When I leave the dockable outline
    Then the dockable outline is collapsed
    When I scroll the document to outline heading "Section 2"
    And I hover the dockable outline indicator
    Then dockable outline heading "Section 2" is active
    When I move the pointer to the dockable outline header
    Then the active dockable outline item has the "default" selected background
    And dockable outline heading "Section 3" has no selected background

  Scenario: Keyboard navigation opens the outline, jumps to a heading, and restores focus on Escape
    Given a dockable outline document with 6 headings is open
    When I focus the dockable outline indicator
    Then the dockable outline is expanded
    When I leave the dockable outline
    Then the dockable outline is expanded
    When I press "Tab" in the dockable outline
    Then dockable outline heading "Section 1" has keyboard focus
    When I press "Tab" in the dockable outline
    And I press "Tab" in the dockable outline
    And I press "Enter" in the dockable outline
    Then the document is at outline heading "Section 3"
    When I press "Escape" in the dockable outline
    Then the dockable outline is collapsed
    And the dockable outline indicator has keyboard focus
    When I press "Enter" in the dockable outline
    Then the dockable outline is expanded

  Scenario: Multi-column scroll tracking follows visual heading positions
    Given a multi-column dockable outline document is open
    When I hover the dockable outline indicator
    And I scroll the document to outline heading "Section 3"
    Then dockable outline heading "Section 3" is active
    When I scroll the outline article to the bottom
    Then dockable outline heading "Section 2" is active

  Scenario: Moving a heading updates scroll tracking without scrolling or resizing
    Given a dockable outline document with equal-height headings is open
    When I position outline document heading "Section 1" 40 pixels above the reading line
    And I hover the dockable outline indicator
    Then dockable outline heading "Section 1" is active
    When I remember the outline article layout
    And I move the second outline heading directly below the first
    Then dockable outline heading "Section 2" is active
    And the outline editor height and heading order are unchanged
    And the outline article layout and scroll position are unchanged

  Scenario: Clicking nearby headings replaces the selected item in editable and published pages
    Given a compact dockable outline document with 3 headings is open
    Then all outline document headings are in the viewport
    When I hover the dockable outline indicator
    And I click dockable outline heading "Section 3"
    And I click dockable outline heading "Section 2"
    And I move the pointer to the dockable outline header
    Then dockable outline heading "Section 2" is active
    And dockable outline heading "Section 3" has no selected background
    When I click dockable outline heading "Section 1"
    And I move the pointer to the dockable outline header
    Then dockable outline heading "Section 1" is active
    And dockable outline heading "Section 2" has no selected background
    When I publish the page from the share panel
    And I visit the published outline document
    Then all outline document headings are in the viewport
    When I click dockable outline heading "Section 3"
    And I click dockable outline heading "Section 2"
    And I move the pointer to the dockable outline header
    Then dockable outline heading "Section 2" is active
    And dockable outline heading "Section 3" has no selected background
    When I click dockable outline heading "Section 1"
    And I move the pointer to the dockable outline header
    Then dockable outline heading "Section 1" is active
    And dockable outline heading "Section 2" has no selected background
    When I return to the outline editor
    And I unpublish the page from the share panel

  Scenario: Page mentions retain their resolved names and surrounding text in both outlines
    Given a compact dockable outline document with 3 headings is open
    When I replace outline headings with page mentions and surrounding text
    And I hover the dockable outline indicator
    Then dockable outline heading "Desktop guide" is listed
    And dockable outline heading "To-dos quick start" is listed
    When I reload the outline document
    And I hover the dockable outline indicator
    Then dockable outline heading "Desktop guide" is listed
    And dockable outline heading "To-dos quick start" is listed
    When I move to the end of the outline document
    And I open the slash menu
    And I select slash command "outline"
    And I hover the dockable outline indicator
    Then both outlines show the resolved page-mention headings
    When I reload the outline document
    And I hover the dockable outline indicator
    Then both outlines show the resolved page-mention headings
    When I publish the page from the share panel
    And I visit the published outline document
    Then both outlines show the resolved page-mention headings
    When I reload the outline document
    Then both outlines show the resolved page-mention headings
    When I return to the outline editor
    And I unpublish the page from the share panel

  Scenario Outline: Long outlines scroll inside a panel and follow the current theme
    Given a dockable outline document with 30 headings is open
    And the dockable outline uses the "<theme>" theme
    When I hover the dockable outline indicator
    Then the dockable outline is expanded
    And the dockable outline fits above the viewport bottom gap
    And the dockable outline has room for at least 8 headings
    And the dockable outline has an internal scrollbar
    And the dockable outline uses the theme surface and text colors
    When I scroll the document to outline heading "Section 26"
    Then dockable outline heading "Section 26" is active
    And the active dockable outline item is visible in its scroll area
    When I move the pointer to the dockable outline header
    Then the active dockable outline item has the "default" selected background

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: Long outlines resize with the window and scroll independently of the article
    Given a dockable outline document with 30 headings is open
    When I hover the dockable outline indicator
    And I resize the outline viewport to height 600
    Then the dockable outline fits above the viewport bottom gap
    And the dockable outline has room for at least 8 headings
    When I remember the outline article layout
    And I scroll inside the dockable outline
    Then the outline article layout and scroll position are unchanged
    When I resize the outline viewport to height 360
    Then the dockable outline fits above the viewport bottom gap
    And the dockable outline has an internal scrollbar
    When I leave the dockable outline
    Then the dockable outline is collapsed
    And the dockable outline indicator fits above the viewport bottom gap
    When I resize the outline viewport to height 1000
    And I hover the dockable outline indicator
    Then the dockable outline fits above the viewport bottom gap
    And the dockable outline has room for at least 8 headings
    When I scroll the document to outline heading "Section 26"
    Then dockable outline heading "Section 26" is active
    And the active dockable outline item is visible in its scroll area
    When I resize the outline viewport to height 600
    Then dockable outline heading "Section 26" is active
    And the active dockable outline item is visible in its scroll area
    And the dockable outline fits above the viewport bottom gap

  Scenario: Comments take priority and restore a collapsed outline
    Given a dockable outline document with 4 headings is open
    When I hover the dockable outline indicator
    And I open the inline comment panel for the outline document
    Then the dockable outline is absent
    When I close the inline comment panel for the outline document
    Then the dockable outline is collapsed

  Scenario: Page side peeks take priority and restore a collapsed outline
    Given a dockable outline document with 4 headings is open
    When I hover the dockable outline indicator
    And I open a page side peek from the outline document
    Then the dockable outline is absent
    When I close the page side peek from the outline document
    Then the dockable outline is collapsed
    When I hover the dockable outline indicator
    Then the dockable outline contains 4 headings

  Scenario: Inline outline depth stays independent while its color is shared
    Given a dockable outline document with 6 headings is open
    And the dockable outline uses the "light" theme
    When I move to the end of the outline document
    And I open the slash menu
    And I select slash command "outline"
    And I customize the inline outline to purple and depth 2
    And I hover the dockable outline indicator
    Then the dockable outline contains 6 headings
    And the inline outline contains 2 headings
    And both outlines share the purple accent
    And the dockable outline has no internal scrollbar
    When I move the pointer to the dockable outline header
    Then the active dockable outline item has the "purple" selected background
    When I reload the outline document
    And I hover the dockable outline indicator
    Then the dockable outline contains 6 headings
    And the inline outline contains 2 headings
    And both outlines share the purple accent
    When I move the pointer to the dockable outline header
    Then the active dockable outline item has the "purple" selected background

  Scenario: Published outline display mode is local to the open page
    Given a dockable outline document with 4 headings is open
    When I publish the page from the share panel
    And I visit the published outline document
    Then the dockable outline is expanded
    And dockable outline display mode "Always show" is selected
    When I choose dockable outline display mode "Show on hover"
    And I leave the dockable outline
    Then the dockable outline is collapsed
    When I hover the dockable outline indicator
    Then dockable outline display mode "Show on hover" is selected
    When I open the published outline in another tab
    Then the dockable outline is expanded
    When I return to the original published outline tab
    And I leave the dockable outline
    Then the dockable outline is collapsed
    When I reload the outline document
    Then the dockable outline is expanded
    And dockable outline display mode "Always show" is selected
    When I choose dockable outline display mode "Show on hover"
    And I leave the dockable outline
    Then the dockable outline is collapsed
    When I hover the dockable outline indicator
    And I choose dockable outline display mode "Always show"
    And I leave the dockable outline
    Then the dockable outline is expanded
    When I return to the outline editor
    And I unpublish the page from the share panel
