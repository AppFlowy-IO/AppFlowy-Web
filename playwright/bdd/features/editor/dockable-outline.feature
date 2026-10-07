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
    When I leave the dockable outline
    Then the dockable outline is collapsed
    When I scroll the document to outline heading "Section 2"
    And I hover the dockable outline indicator
    Then dockable outline heading "Section 2" is active

  Scenario Outline: Long outlines scroll inside a panel and follow the current theme
    Given a dockable outline document with 30 headings is open
    And the dockable outline uses the "<theme>" theme
    When I hover the dockable outline indicator
    Then the dockable outline is expanded
    And the dockable outline fits above the viewport bottom gap
    And the dockable outline has an internal scrollbar
    And the dockable outline uses the theme surface and text colors
    When I scroll the document to outline heading "Section 26"
    Then dockable outline heading "Section 26" is active
    And the active dockable outline item is visible in its scroll area

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: Comments take priority and restore a collapsed outline
    Given a dockable outline document with 4 headings is open
    When I hover the dockable outline indicator
    And I open the inline comment panel for the outline document
    Then the dockable outline is absent
    When I close the inline comment panel for the outline document
    Then the dockable outline is collapsed

  Scenario: Inline outline depth stays independent while its color is shared
    Given a dockable outline document with 6 headings is open
    When I move to the end of the outline document
    And I open the slash menu
    And I select slash command "outline"
    And I customize the inline outline to purple and depth 2
    And I hover the dockable outline indicator
    Then the dockable outline contains 6 headings
    And the inline outline contains 2 headings
    And both outlines share the purple accent
    And the dockable outline has no internal scrollbar
    When I reload the outline document
    And I hover the dockable outline indicator
    Then the dockable outline contains 6 headings
    And the inline outline contains 2 headings
    And both outlines share the purple accent

  Scenario: Published outline display mode is a persistent reader preference
    Given a dockable outline document with 4 headings is open
    When I publish the page from the share panel
    And I visit the published outline document
    Then the dockable outline is expanded
    When I choose dockable outline display mode "Show on hover"
    And I leave the dockable outline
    Then the dockable outline is collapsed
    When I reload the outline document
    Then the dockable outline is collapsed
    When I hover the dockable outline indicator
    And I choose dockable outline display mode "Always show"
    And I leave the dockable outline
    Then the dockable outline is expanded
    When I return to the outline editor
    And I unpublish the page from the share panel
