Feature: Preserve the document position when returning to a browser tab
  Regression for https://github.com/AppFlowy-IO/AppFlowy/issues/9021.
  Background permission checks must not focus the page title again.

  Scenario: Returning to a scrolled document preserves its content and position
    Given a blank document page is open
    When I fill the document with enough content to scroll
    And I return to the document tab after scrolling down
    Then the document keeps its scroll position without focusing the title
