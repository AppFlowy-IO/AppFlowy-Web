Feature: Board renders whenever its database opens
  A database that opens in a Grid view must also open in its Board view. Before
  this fix the same database could leave the Board loading forever, render
  nothing at all, or show a dead-end message with no way to recover.

  Scenario: A row whose data never loads does not keep the Board loading
    Given a Grid database with a Board view is open for Board rendering
    And the database lists a row whose data does not exist on the server
    When I reopen the Board view
    Then the Board shows its columns with every loaded card
    When I switch to the Grid view of the Board rendering database
    Then the Grid view of the Board rendering database shows its rows

  Scenario: A Board without grouping or a Select property groups by a new Status property
    Given a Grid database with a Board view is open for Board rendering
    And the Board has no grouping and the database has no Select or Checkbox property
    When I reopen the Board view
    Then the Board is grouped by a new "Status" Single select property
    And the Board shows every loaded card in the "No Status" column

  Scenario: A Board grouped by a property it cannot draw explains why and can be regrouped
    Given a Grid database grouped by a new Date property is open for Board rendering
    When I add a Board view from the tab bar for Board rendering
    Then the Board says it cannot draw its grouping by the Date property
    When I group the Board by "Type" from the Board message
    Then the Board shows its columns with every loaded card
