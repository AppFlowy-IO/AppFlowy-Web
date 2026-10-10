Feature: Database side peek layout and close

  How the row peek closes and fits the page: Escape and the backdrop dismiss
  it after its edits are saved, Escape with the "Open page in" menu open only
  closes the menu, a narrow viewport forces center mode and disables "Side
  peek", the side slot resizes between its 560 px minimum and its two-thirds
  cap, and the comments panel reclaims width from the side slot.

  Scenario: Escape closes the side peek after saving its edits
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Escape" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop
    When I set the peek title to "Amber via Escape"
    And I close the peek with Escape
    Then no peek is open
    When I reload the database page
    Then the visible rows are "Amber via Escape, Birch, Cedar"

  Scenario: Escape with the "Open page in" menu open closes only the menu
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Menu Escape" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    When I open the peek mode menu
    Then the peek mode menu is open
    When I press Escape while the peek mode menu is open
    Then the peek mode menu is closed
    And the peek is open in side mode showing "Amber"
    When I close the peek with Escape
    Then no peek is open

  Scenario: Escape with the "Open page in" menu open closes only the menu of a center peek
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Center Menu Escape" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    And I switch the open row to "Center peek"
    Then the peek is open in center mode showing "Amber"
    When I open the peek mode menu
    Then the peek mode menu is open
    # The open menu owns Escape in either shell: the center dialog must not treat it as its own close key.
    When I press Escape while the peek mode menu is open
    Then the peek mode menu is closed
    And the peek is open in center mode showing "Amber"
    When I close the peek with Escape
    Then no peek is open

  Scenario: Clicking the backdrop closes a center peek after saving its edits
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Backdrop" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    And I switch the open row to "Center peek"
    Then the peek is open in center mode showing "Amber"
    When I set the peek title to "Amber via backdrop"
    And I close the peek by clicking the backdrop
    Then no peek is open
    When I reload the database page
    Then the visible rows are "Amber via backdrop, Birch, Cedar"

  Scenario: A 900 px viewport opens the row centered and disables Side peek
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Narrow" with rows "Amber, Birch, Cedar"
    When I set the viewport to 900x900
    And I open the row "Amber" in the peek from the grid
    Then the peek is open in center mode showing "Amber"
    When I open the peek mode menu
    Then the "Side peek" option of the peek mode menu is disabled
    And the "Center peek" option of the peek mode menu is enabled
    When I choose "Center peek" from the open peek mode menu
    Then the peek mode menu is closed
    And the peek is open in center mode showing "Amber"
    When I close the peek by clicking the backdrop
    Then no peek is open

  Scenario: Shrinking the viewport moves an open side peek to center and growing it back restores side
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Viewport" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    When I set the peek title to "Amber draft"
    And I mark the peek title editor
    And I set the viewport to 900x900
    Then the peek is open in center mode showing "Amber draft"
    And the peek title editor was not recreated
    When I set the viewport to 1440x900
    Then the peek is open in side mode showing "Amber draft"
    And the peek has no backdrop
    And the peek title editor was not recreated
    When I close the peek with the close button
    Then no peek is open

  Scenario: The resizer keeps the side peek between its 560 px minimum and the two-thirds cap
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Resizer" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the side peek minimum width is 560 px
    And the side peek width is at its minimum
    And the side peek maximum width is two thirds of the available width
    When I drag the side peek resizer 120 px to the left
    Then the side peek is wider than before
    And the side peek width is within its bounds
    When I drag the side peek resizer 400 px to the left
    Then the side peek width is at its maximum
    And the side peek width is within its bounds
    When I drag the side peek resizer 400 px to the right
    Then the side peek width is at its minimum
    And the side peek width is within its bounds
    When I press ArrowLeft on the side peek resizer
    Then the side peek is wider than before
    When I press ArrowRight on the side peek resizer
    Then the side peek is narrower than before
    And the side peek width is at its minimum
    When I press ArrowRight on the side peek resizer
    Then the side peek width is at its minimum
    When I press End on the side peek resizer
    Then the side peek width is at its maximum
    When I press ArrowLeft on the side peek resizer
    Then the side peek width is at its maximum
    When I press Home on the side peek resizer
    Then the side peek width is at its minimum
    And the side peek width is within its bounds

  Scenario: The comments panel reclaims width from the side peek
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Comments" with rows "Amber, Birch, Cedar"
    And I have created a document named "Peek Comments Host" with a linked grid "Peek Comments"
    When I set the viewport to 1800x900
    And I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    When I press End on the side peek resizer
    Then the side peek width is at its maximum
    When I remember the side peek width
    And I open the comments panel from the page header
    Then the side peek is narrower than before
    And the side peek width is at its maximum
    And the side peek maximum width is two thirds of the available width
    And the side peek width is within its bounds
    When I remember the side peek width
    And I close the comments panel
    Then the comments panel is closed
    And the side peek is wider than before
    And the side peek width is at its maximum
    # At 1200 px the 352 px comments panel leaves less than the 880 px a side peek needs, so it falls back to center.
    When I open the comments panel from the page header
    And I set the viewport to 1200x900
    Then the peek is open in center mode showing "Amber"
    When I close the comments panel
    Then the comments panel is closed
    And the peek is open in side mode showing "Amber"
