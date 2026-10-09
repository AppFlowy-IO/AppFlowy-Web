Feature: Database side peek modes

  Mirrors the desktop "Pending row edits survive every peek mode transition"
  scenario. A title draft, a checkbox property and appended document text made
  in one surface are all still there in the next one, through side peek,
  center peek, side peek again, the full row page and a new browser tab. The
  surface reports each mode through data-peek-mode, and at 1440x900 a row
  opens in side peek by default.

  On the web "New tab" is a peek header command, so the last
  transition returns to the grid and takes it from the row's reopened peek.

  Scenario: Pending row edits survive every peek mode transition
    Given I am signed in for side peek testing
    And I have created a grid named "Peek mode edits" with rows "Amber, Birch, Cedar"
    And the grid has a checkbox property named "Peek completed"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop
    And the "Peek completed" checkbox in the peek is unchecked

    # Side peek -> center peek: the title draft is still pending when the mode changes
    When I toggle the "Peek completed" checkbox in the peek
    And I append "Side content" to the peek document
    And I set the peek title to "Side draft"
    And I switch the open row to "Center peek"
    Then the peek is open in center mode showing "Side draft"
    And the "Peek completed" checkbox in the peek is checked
    And the peek document contains "Side content"

    # Center peek -> side peek
    When I toggle the "Peek completed" checkbox in the peek
    And I append " center content" to the end of the peek document
    And I set the peek title to "Center draft"
    And I switch the open row to "Side peek"
    Then the peek is open in side mode showing "Center draft"
    And the "Peek completed" checkbox in the peek is unchecked
    And the peek document contains "Side content center content"

    # Side peek -> full row page: the pending edits are saved before the page opens
    When I toggle the "Peek completed" checkbox in the peek
    And I append " full page content" to the end of the peek document
    And I set the peek title to "Full page draft"
    And I switch the open row to "Full page"
    Then the full row page for "Full page draft" is open
    And the "Peek completed" checkbox on the full row page is checked
    And the full row page document contains "Side content center content full page content"
    When I reload the full row page
    Then the full row page for "Full page draft" is open
    And the "Peek completed" checkbox on the full row page is checked
    And the full row page document contains "Side content center content full page content"

    # Side peek -> new tab: the pending edits are saved before the tab loads the row
    When I return to the grid page from the full row page
    And I open the row "Full page draft" in the peek from the grid
    Then the peek is open in side mode showing "Full page draft"
    And the "Peek completed" checkbox in the peek is checked
    And the peek document contains "Side content center content full page content"
    When I toggle the "Peek completed" checkbox in the peek
    And I append " new tab content" to the end of the peek document
    And I set the peek title to "New tab draft"
    And I switch the open row to "New tab"
    Then the current browser tab shows the full row page for "New tab draft"
    And the "Peek completed" checkbox on the full row page is unchecked
    And the full row page document contains "Side content center content full page content new tab content"
    When I switch to browser tab 1
    Then the peek in this tab is still open showing "New tab draft"
    When I close the peek with the close button
    And I reload the database page
    Then the "Peek completed" checkbox of grid row "New tab draft" is unchecked
