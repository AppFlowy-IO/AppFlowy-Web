Feature: Database row document
  Row document content should be reflected in the database primary cell.

  Scenario: Image link content shows the row document indicator
    Given a board database with a card is open
    When I add image link "https://example.com/row-page-image.png" to the card row page
    And I close the card row page
    Then the card primary cell shows a row document icon
