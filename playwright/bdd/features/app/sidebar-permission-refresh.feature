@sidebar-permission-refresh
Feature: Sidebar stability after a page permission change
  Changing access to one page should preserve unrelated expanded sidebar branches.

  Scenario Outline: Refresh a page permission without reloading sibling branches
    Given I have expanded sidebar branches for permission refresh testing
    When a remote "<notification>" notification says the page access was "<access>"
    Then unrelated sidebar branches stay mounted while permission refresh is pending
    When the sidebar permission refresh finishes
    Then the sidebar reflects the "<access>" page access without remounting unrelated branches

    Examples:
      | notification | access  |
      | permission   | changed |
      | share        | changed |
      | permission   | revoked |
      | share        | revoked |
