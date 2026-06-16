@mention-search
Feature: Mention panel search
  The Web mention panel should exercise the same server mention API behavior through the editor UI.

  Background:
    Given the mention search fixture owner is signed in
    And the mention search fixture member can be mentioned

  Scenario: Empty mention query shows defaults without links or database rows
    Given a blank mention search document page is open
    When I open the mention panel with an empty query
    Then the mention panel shows date quick picks
    And the mention panel does not show a links section
    And the mention panel does not show database rows

  Scenario: Typed mention query filters fixture people
    Given a blank mention search document page is open
    When I search mentions for the fixture member
    Then the mention panel shows the fixture member

  Scenario: Typed URL-like mention query shows an external link
    Given a blank mention search document page is open
    When I search mentions for "example.com"
    Then the mention panel shows an external link for "example.com"

  Scenario: Typed mention query searches embedded database rows
    Given a mention search document contains an indexed fixture database row
    When I search mentions for the fixture database row
    Then the browser sent a database-row mention search request
    And the mention panel shows the fixture database row
