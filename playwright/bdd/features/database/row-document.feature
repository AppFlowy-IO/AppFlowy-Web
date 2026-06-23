Feature: Database row document
  Row document content should be reflected in the database primary cell.

  Scenario: Image link content shows the row document indicator
    Given a board database with a card is open
    When I add image link "https://example.com/row-page-image.png" to the card row page
    And I close the card row page
    Then the card primary cell shows a row document icon
    When I switch the database to a new Grid view
    Then the grid primary cell shows a row document icon

  Scenario: Duplicating an inline grid block in a row page creates an independent database
    Given a grid database is open for row-page inline grid duplication
    When I open the first row as a full row page
    And I create an inline grid in the row page
    And I duplicate the inline grid block in the row page
    Then the duplicated inline grid shows a loading placeholder
    Then the duplicated inline grid has a fresh database view id
    When I edit the duplicated inline grid
    Then the original row-page inline grid remains unchanged
    When I edit the original inline grid
    Then the duplicated row-page inline grid remains unchanged
