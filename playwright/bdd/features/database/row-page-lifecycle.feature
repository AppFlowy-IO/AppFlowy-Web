@row-page-lifecycle
Feature: Database row page trash and restore lifecycle
  A database row whose document has content behaves like a page: deleting the
  row moves its row page to trash, the trashed row page can be restored (which
  reactivates the row in every database view) or permanently deleted, and the
  row page can be favorited and renamed with the favorites entry tracking the
  title. Ported from the desktop BDD test cloud_row_page_trash_restore.feature.

  Scenario: Deleting a row with content moves its row page to trash and restore reactivates the row
    Given I am signed in with a new account
    And I have created a grid page named "Row Page Trash Restore Grid"
    And I switch the database to a new Grid view
    # An empty row (no document content) is hard-deleted from every view and
    # never reaches trash
    When I switch to the database view at index 0
    And I set the first grid cell to "Empty Row Delete Target"
    And I delete the grid row named "Empty Row Delete Target"
    Then the grid does not contain a row named "Empty Row Delete Target"
    And the database view at index 1 does not contain a row named "Empty Row Delete Target"
    And the trash does not contain a row page named "Empty Row Delete Target"
    # Give a fresh row a title, visible in both views, then row-page content
    When I return to the grid page
    And I switch to the database view at index 0
    And I set the first grid cell to "Row Page Trash Source"
    Then the grid contains a row named "Row Page Trash Source"
    And the database view at index 1 contains a row named "Row Page Trash Source"
    When I switch to the database view at index 0
    And I open the grid row named "Row Page Trash Source" as a full row page
    And I type "row page content before trash" into the row document
    And I favorite the current row page
    Then the Favorites section contains an entry named "Row Page Trash Source"
    # Renaming the row page keeps the favorites entry in sync
    When I rename the current row page to "Row Page Trash Restored"
    Then the Favorites section contains an entry named "Row Page Trash Restored"
    And the Favorites section does not contain an entry named "Row Page Trash Source"
    When I open the Favorites entry named "Row Page Trash Restored"
    Then the current page is a full row page
    # The renamed title is visible in every database view before deleting
    When I return to the grid page
    Then the grid contains a row named "Row Page Trash Restored"
    And the database view at index 1 contains a row named "Row Page Trash Restored"
    # Deleting the row (with content) sends its row page to trash in all views
    When I switch to the database view at index 0
    And I delete the grid row named "Row Page Trash Restored"
    Then the grid does not contain a row named "Row Page Trash Restored"
    And the database view at index 1 does not contain a row named "Row Page Trash Restored"
    And the trash contains a row page named "Row Page Trash Restored"
    # Restore brings the row back in every view
    When I restore the row page named "Row Page Trash Restored" from trash
    Then the trash does not contain a row page named "Row Page Trash Restored"
    When I return to the grid page
    Then the grid contains a row named "Row Page Trash Restored"
    And the database view at index 1 contains a row named "Row Page Trash Restored"
    # Permanent delete removes the row for good
    When I switch to the database view at index 0
    And I delete the grid row named "Row Page Trash Restored"
    Then the grid does not contain a row named "Row Page Trash Restored"
    And the database view at index 1 does not contain a row named "Row Page Trash Restored"
    And the trash contains a row page named "Row Page Trash Restored"
    When I permanently delete the row page named "Row Page Trash Restored" from trash
    Then the trash does not contain a row page named "Row Page Trash Restored"
    When I return to the grid page
    Then the grid does not contain a row named "Row Page Trash Restored"
    And the database view at index 1 does not contain a row named "Row Page Trash Restored"
