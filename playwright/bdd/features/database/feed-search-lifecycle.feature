@feed-interactions
Feature: Feed search preserves drafts without mounting every card

  Background:
    Given the Feed interaction fixture is ready

  Scenario: Searching beyond the first page preserves an existing draft
    Given a Feed with thirty-five rows and a match outside the first page
    When the user drafts a comment and searches for a missing value
    Then no additional Feed cards are mounted for the empty result
    When the user searches for the row outside the first page
    Then only that result is added and clearing search restores the draft

  Scenario: A remote rename makes a never-mounted row match the active search
    Given a Feed with thirty-five rows and a match outside the first page
    And a fresh second tab searches for a value that no row contains
    When the original tab renames a never-mounted row to match that search
    Then the second tab shows the live result without remounting its Feed
