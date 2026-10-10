Feature: Database side peek smoke

  Proves the shared side peek step library end to end: a grid row opens in the
  nonmodal side peek, the "Open page in" menu switches it to center peek, and
  the close button dismisses it.

  Scenario: Open a row in side peek, switch to center peek and close it
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Smoke" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek has no backdrop
    And the previous row button is disabled
    And the next row button is enabled
    When I switch the open row to "Center peek"
    Then the peek is open in center mode showing "Amber"
    When I close the peek with the close button
    Then no peek is open
