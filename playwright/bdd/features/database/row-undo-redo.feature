Feature: Database row undo redo
  Database history should undo ordinary database and row actions while leaving unsupported relation cells unchanged.

  Scenario: Row title supports undo and redo from row detail
    Given a grid database row named "Undo Base" is open for undo redo
    When I rename the open database row to "Undo Changed"
    And I trigger database row undo
    Then the open database row title is "Undo Base"
    When I trigger database row redo
    Then the open database row title is "Undo Changed"

  Scenario: Grid cell supports undo and redo after commit
    Given a grid database is ready for cell undo redo
    When I type "123" into the first grid cell
    And I activate the next grid cell
    And I trigger database row undo
    Then the first grid cell is ""
    When I trigger database row redo
    Then the first grid cell is "123"

  Scenario: Grid undo and redo follow edits across row documents
    Given a grid database is ready for cell undo redo
    When I type "111" into the first grid cell
    And I type "222" into the second grid cell
    And I activate the first grid cell
    And I trigger database row undo
    Then the second grid cell is ""
    And the first grid cell is "111"
    When I trigger database row undo
    Then the first grid cell is ""
    When I trigger database row redo
    Then the first grid cell is "111"
    When I trigger database row redo
    Then the second grid cell is "222"

  Scenario: Database row insertion supports undo and redo
    Given a grid database is ready for cell undo redo
    When I add a new database row for undo redo
    Then the added database row is present
    When I trigger database row undo
    Then the added database row is removed
    When I trigger database row redo
    Then the added database row is present

  Scenario: Database row reorder supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    Then the first visible database row is "Alpha"
    When I move the last database row to the top for undo redo
    Then the first visible database row is "Gamma"
    When I trigger database row undo
    Then the first visible database row is "Alpha"
    When I trigger database row redo
    Then the first visible database row is "Gamma"

  Scenario: Relation cell changes are not captured by row undo
    Given a grid database relation cell is ready for undo redo
    When I link the relation cell to "Target Row"
    And I open the source database row page
    And I trigger database row undo
    Then the relation cell still links to "Target Row"

  Scenario: Database field creation supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    When I create a text field named "Undo Text" for undo redo
    Then the undo redo field "Undo Text" exists
    When I trigger database row undo
    Then the undo redo field "Undo Text" is removed
    When I trigger database row redo
    Then the undo redo field "Undo Text" exists

  Scenario: Database field rename supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    And a text field named "Original Field" exists for undo redo
    When I rename the undo redo field to "Renamed Field"
    Then the undo redo field is named "Renamed Field"
    When I trigger database row undo
    Then the undo redo field is named "Original Field"
    When I trigger database row redo
    Then the undo redo field is named "Renamed Field"

  Scenario: Database field deletion supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    And a text field named "Delete Field" exists for undo redo
    And I set the first row value in the undo redo field to "field value"
    When I delete the undo redo field
    Then the undo redo field "Delete Field" is removed
    When I trigger database row undo
    Then the undo redo field "Delete Field" exists
    And the first row value in the undo redo field is "field value"
    When I trigger database row redo
    Then the undo redo field "Delete Field" is removed

  Scenario: Database field type change supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    And a text field named "Type Field" exists for undo redo
    When I change the undo redo field type to checkbox
    Then the undo redo field type is checkbox
    When I trigger database row undo
    Then the undo redo field type is text
    When I trigger database row redo
    Then the undo redo field type is checkbox

  Scenario: Database filter creation supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    When I create a text filter containing "Alpha" for undo redo
    Then the database has 1 filter with content "Alpha"
    When I trigger database row undo
    Then the database has 0 filters
    When I trigger database row redo
    Then the database has 1 filter with content "Alpha"

  Scenario: Database filter update supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    And a text filter containing "Alpha" exists for undo redo
    When I update the undo redo filter content to "Beta"
    Then the database has 1 filter with content "Beta"
    When I trigger database row undo
    Then the database has 1 filter with content "Alpha"
    When I trigger database row redo
    Then the database has 1 filter with content "Beta"

  Scenario: Database filter deletion supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    And a text filter containing "Alpha" exists for undo redo
    When I delete the undo redo filter
    Then the database has 0 filters
    When I trigger database row undo
    Then the database has 1 filter with content "Alpha"
    When I trigger database row redo
    Then the database has 0 filters

  Scenario: Database sort creation supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    When I create an ascending sort for undo redo
    Then the database has 1 ascending sort
    When I trigger database row undo
    Then the database has 0 sorts
    When I trigger database row redo
    Then the database has 1 ascending sort

  Scenario: Database group creation supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    When I create a group for undo redo
    Then the database has 1 group
    When I trigger database row undo
    Then the database has 0 groups
    When I trigger database row redo
    Then the database has 1 group

  Scenario: Database calculation creation supports undo and redo
    Given a seeded grid database is ready for complex undo redo
    When I create a calculation for undo redo
    Then the database has 1 calculation
    When I trigger database row undo
    Then the database has 0 calculations
    When I trigger database row redo
    Then the database has 1 calculation

  Scenario: Field creation and row cell edit undo across database and row docs
    Given a seeded grid database is ready for complex undo redo
    When I create a text field named "Mixed Field" for undo redo
    And I set the first row value in the undo redo field to "123"
    Then the first row value in the undo redo field is "123"
    When I trigger database row undo
    Then the first row value in the undo redo field is ""
    When I trigger database row undo
    Then the undo redo field "Mixed Field" is removed
    When I trigger database row redo
    Then the undo redo field "Mixed Field" exists
    When I trigger database row redo
    Then the first row value in the undo redo field is "123"

  Scenario: Filter creation and row edit undo across database and row docs
    Given a seeded grid database is ready for complex undo redo
    When I create a text filter containing "Alpha" for undo redo
    And I set the first grid cell directly to "Alpha Edited"
    Then the first grid cell is "Alpha Edited"
    When I trigger database row undo
    Then the first grid cell is "Alpha"
    When I trigger database row undo
    Then the database has 0 filters
    When I trigger database row redo
    Then the database has 1 filter with content "Alpha"
    When I trigger database row redo
    Then the first grid cell is "Alpha Edited"

  Scenario: Sort creation and row value edit undo across database and row docs
    Given a seeded grid database is ready for complex undo redo
    When I create an ascending sort for undo redo
    And I set the first grid cell directly to "Zulu"
    Then the first grid cell is "Zulu"
    When I trigger database row undo
    Then the first grid cell is "Alpha"
    When I trigger database row undo
    Then the database has 0 sorts
    When I trigger database row redo
    Then the database has 1 ascending sort
    When I trigger database row redo
    Then the first grid cell is "Zulu"

  Scenario: Row reorder and row edit undo across database and row docs
    Given a seeded grid database is ready for complex undo redo
    When I move the last database row to the top for undo redo
    And I set the first grid cell directly to "Alpha Edited"
    Then the first visible database row is "Gamma"
    And the first grid cell is "Alpha Edited"
    When I trigger database row undo
    Then the first grid cell is "Alpha"
    And the first visible database row is "Gamma"
    When I trigger database row undo
    Then the first visible database row is "Alpha"
    When I trigger database row redo
    Then the first visible database row is "Gamma"
    When I trigger database row redo
    Then the first grid cell is "Alpha Edited"
    And the first visible database row is "Gamma"

  Scenario: Added row and row cell edits undo across database and row docs
    Given a seeded grid database is ready for complex undo redo
    When I add a direct database row for complex undo redo
    And I set the added row primary cell to "Added Row"
    Then the added database row is present
    And the added row primary cell is "Added Row"
    When I trigger database row undo
    Then the added row primary cell is ""
    When I trigger database row undo
    Then the added database row is removed
    When I trigger database row redo
    Then the added database row is present
    When I trigger database row redo
    Then the added row primary cell is "Added Row"

  Scenario: Field add row add and new cell edit undo across docs
    Given a seeded grid database is ready for complex undo redo
    When I create a text field named "Triple Field" for undo redo
    And I add a direct database row for complex undo redo
    And I set the added row value in the undo redo field to "triple"
    Then the added row value in the undo redo field is "triple"
    When I trigger database row undo
    Then the added row value in the undo redo field is ""
    When I trigger database row undo
    Then the added database row is removed
    When I trigger database row undo
    Then the undo redo field "Triple Field" is removed
    When I trigger database row redo
    Then the undo redo field "Triple Field" exists
    When I trigger database row redo
    Then the added database row is present
    When I trigger database row redo
    Then the added row value in the undo redo field is "triple"

  Scenario: Multiple row docs and database doc preserve global undo order
    Given a seeded grid database is ready for complex undo redo
    When I set the first grid cell directly to "First Edit"
    And I create a text field named "Ordered Field" for undo redo
    And I set the second grid cell directly to "Second Edit"
    Then the second grid cell is "Second Edit"
    When I trigger database row undo
    Then the second grid cell is "Beta"
    When I trigger database row undo
    Then the undo redo field "Ordered Field" is removed
    When I trigger database row undo
    Then the first grid cell is "Alpha"
    When I trigger database row redo
    Then the first grid cell is "First Edit"
    When I trigger database row redo
    Then the undo redo field "Ordered Field" exists
    When I trigger database row redo
    Then the second grid cell is "Second Edit"

  Scenario: Repeated row edits on the same row preserve undo order
    Given a seeded grid database is ready for complex undo redo
    When I set the first grid cell directly to "First Edit"
    And I set the first grid cell directly to "Second Edit"
    Then the first grid cell is "Second Edit"
    When I trigger database row undo
    Then the first grid cell is "First Edit"
    When I trigger database row undo
    Then the first grid cell is "Alpha"
    When I trigger database row redo
    Then the first grid cell is "First Edit"
    When I trigger database row redo
    Then the first grid cell is "Second Edit"

  Scenario: Relation database operation does not pollute undo history
    Given a seeded grid database is ready for complex undo redo
    When I create a text field named "Before Relation" for undo redo
    And I create a skipped relation field named "Skipped Relation"
    Then the undo redo field "Before Relation" exists
    And the skipped relation field "Skipped Relation" exists
    When I trigger database row undo
    Then the undo redo field "Before Relation" is removed
    And the skipped relation field "Skipped Relation" exists

  Scenario: Unsupported relation cell followed by supported text cell undo
    Given a seeded grid database is ready for complex undo redo
    And a skipped relation field named "Skipped Relation" exists for undo redo
    When I set the skipped relation cell to the second row
    And I set the first grid cell directly to "Supported Edit"
    Then the skipped relation cell still links to the second row
    And the first grid cell is "Supported Edit"
    When I trigger database row undo
    Then the skipped relation cell still links to the second row
    And the first grid cell is "Alpha"
    When I trigger database row redo
    Then the skipped relation cell still links to the second row
    And the first grid cell is "Supported Edit"
