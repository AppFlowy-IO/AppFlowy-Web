@inline-comment @inline-comment-mentions
Feature: Person mentions in document comments
  A selected person must retain their identity when a comment or reply is saved.

  Background:
    Given I am signed in for document comment mention tests
    And a fresh document for comment mentions is open

  Scenario: Mention people in a new comment and reply and retain both after refresh
    When I open a new comment for mention testing
    And I type "@" in the comment mention input
    Then the comment person suggestions are visible
    When I select a comment person with the keyboard
    Then the selected person is shown as a readable comment draft
    When I save the comment mention
    Then the selected comment person identity is saved
    When I open the comment reply for mention testing
    And I type "@" in the comment mention input
    Then the comment person suggestions are visible
    When I select a comment person with the mouse
    Then the selected person is shown as a readable comment draft
    When I save the comment mention
    Then the selected comment person identity is saved
    When I refresh the document with comment mentions
    Then both comment person mentions remain visible

  Scenario: Escape dismisses an unmatched person query before closing the reply
    Given a plain comment for mention testing exists
    When I open the comment reply for mention testing
    And I type "@no-person-matches-665" in the comment mention input
    Then the comment person suggestions show no results
    When I press Escape in the comment mention input
    Then the comment mention draft is still open
    When I press Escape in the comment mention input
    Then the comment mention draft is closed

  Scenario: Editing a selected person label removes their mention identity
    When I open a new comment for mention testing
    And I type "@" in the comment mention input
    And I select a comment person with the mouse
    And I edit the selected comment person's name
    And I save the comment mention
    Then the edited comment is saved without a person mention
