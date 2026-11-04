@row-page-row-sync
Feature: A full row page syncs only the rows that changed
  A full row page shows a single row. The filters, sorts and groups of the view
  it was opened from never apply to it, so opening it must not download every
  row of its database again: it asks the server only for the rows changed since
  this device last synced the database. The view itself still reads every row,
  because its sort needs them all.

  Scenario: Reopening a row page of a sorted grid asks only for changed rows
    Given I am signed in with a new account
    And I have created a grid page named "Row Sync Grid"
    And I set the first grid cell to "Row Sync Target"
    And I sort the grid by its "Name" field
    When I open the grid row named "Row Sync Target" as a full row page
    And I reload the row page
    Then the current page is a full row page
    And reopening the row page asked only for rows changed since its last sync
    When I reopen the sorted grid
    Then the sorted grid asked for every row of its database
