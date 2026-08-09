@move-page-to-workspace
Feature: Copy a page to another workspace
  Moving a page across workspaces follows Notion-compatible semantics: it
  deep-copies owned content into the destination Private section and keeps
  the original in the source workspace.

  Scenario: A page with an embedded database copies into another workspace
    Given I am signed in with a page containing an embedded database in a source workspace and a separate target workspace
    When I copy the page to the target workspace
    Then the original page remains listed in the source workspace sidebar
    And the copied page is listed under the target workspace private space
    And the embedded database is listed under the copied page
