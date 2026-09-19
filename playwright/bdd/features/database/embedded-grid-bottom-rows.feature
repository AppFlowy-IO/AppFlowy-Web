Feature: Reach the bottom rows of an embedded grid
  Regression for https://github.com/AppFlowy-IO/AppFlowy/issues/9022.

  Background:
    Given a blank document page is open
    And an embedded grid with 27 wrapped rows is ready

  Scenario Outline: Growing a scrolled embedded grid keeps its bottom reachable
    When I scroll to the bottom of the embedded grid and click "<action>"
    Then the revealed bottom row and the embedded grid footer are reachable

    Examples:
      | action    |
      | Load more |
      | New row   |
