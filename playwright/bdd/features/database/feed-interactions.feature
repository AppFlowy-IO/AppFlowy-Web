@feed-interactions
Feature: Feed property visibility and discussions

  Background:
    Given the Feed interaction fixture is ready

  Scenario: Visible properties retain their order and visibility
    Given a Feed with two populated properties hidden by default
    When the user shows both properties with the eye controls
    Then values appear horizontally below the title without visible field labels
    When the user drags score before status and hides status
    Then the saved settings survive view switching and reload

  Scenario: A discussion popover retains its mention and attachment when dismissed
    Given a Feed card with an existing discussion
    When the user replies with a mention and file, then dismisses and reopens the discussion
    Then the reply is saved and the popover accepts another comment

  Scenario: A comment arriving from another tab preserves the first inline draft
    Given the same empty Feed card is open in two tabs
    When a first comment arrives while the original tab holds an unsent draft
    Then the draft survives and both tabs receive further discussion updates

  Scenario: Switching reply threads retains drafts and each thread can be resolved
    Given a Feed card with an existing discussion
    When the user drafts replies under two different parent comments
    Then each reply is sent to its original parent and both parents can be resolved independently
