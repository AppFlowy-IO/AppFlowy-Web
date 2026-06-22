@outline-cache
Feature: Sidebar outline disk cache
  The sidebar should use locally cached subtree data while server refresh is slow.

  Scenario: Expanding a cached sidebar view renders local children before refresh completes
    Given I am signed in for sidebar outline cache testing
    And a temporary sidebar space has disk cached children
    And the temporary sidebar space subtree refresh is delayed
    When I expand the cached sidebar space
    Then the sidebar shows the disk cached child before the server refresh completes
    When the delayed sidebar refresh completes
    Then the sidebar shows the refreshed child from the server
