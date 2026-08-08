@move-page-to-workspace
Feature: Move a page to another workspace
  Moving a page deep-copies it (with its content, including embedded
  databases) into a chosen space of another workspace and removes the
  original from the source workspace.

  Scenario: A page with an embedded database moves into a space of another workspace
    Given I am signed in with a page containing an embedded database in a source workspace and a separate target workspace
    When I move the page to the target workspace space
    Then the page is no longer listed in the source workspace sidebar
    And the page is listed under the target workspace space
    And the embedded database is listed under the moved page
