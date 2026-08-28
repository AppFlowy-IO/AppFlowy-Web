Feature: Gallery relation filter pre-fill

  Scenario: New row via toolbar opens row detail and appears first with relation pre-fill
    Given the Gallery test app is initialized
    When the Gallery user signs in anonymously
    Then the Gallery user sees the home page with get started page

    When the user sets up a gallery with relation filter

    And the user clicks the new row button in the database toolbar
    Then the Gallery row detail page is visible
    When the user expands hidden fields in Gallery row detail
    Then the Gallery row detail page shows relation value "Linked Row Target"
    And the Gallery row detail page shows select option "VIP"
    When the user edits the Gallery row title to "FirstNew"
    And the user closes the Gallery row detail page

    Then the gallery card at position 0 has title "FirstNew"

    When the user clicks the new row button in the database toolbar
    Then the Gallery row detail page is visible
    When the user expands hidden fields in Gallery row detail
    Then the Gallery row detail page shows relation value "Linked Row Target"
    And the Gallery row detail page shows select option "VIP"
    When the user closes the Gallery row detail page

    Then the gallery card at position 0 has title "Untitled"
    And the gallery card at position 1 has title "FirstNew"
