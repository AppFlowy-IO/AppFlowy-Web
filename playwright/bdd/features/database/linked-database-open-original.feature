Feature: Open a linked database's original page
  A linked database embedded in a document keeps its own view ID, so both of
  its open-original controls must resolve the database's primary source view.

  Scenario: Header and toolbar actions open the source database
    Given a document contains a linked Grid for open-original testing
    Then the linked Grid shows an open-original header action
    When I open the linked Grid from its header
    Then the original Grid page is open
    When I return to the linked Grid document
    And I open the linked Grid from its toolbar
    Then the original Grid page is open
