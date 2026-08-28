@publish-comments-default
Feature: Comment setting is preserved across republish
  Regression coverage for a reported issue: when a published page is unpublished
  and then published again, its "Comments" setting must be preserved. Previously
  republishing reset comments back to the default, silently changing whether the
  published page accepted public comments.

  Preservation is enforced by the server (it reuses the stored publish config for
  any field omitted on republish), so this scenario exercises the full
  publish -> configure -> unpublish -> republish round-trip.

  Background:
    Given a blank document page is open

  Scenario: Republishing keeps comments enabled when they were enabled before
    When I type "Comments preserved doc" in the editor
    And I publish the page from the share panel
    And I turn the comments toggle on
    Then the comments toggle is on
    When I unpublish the page from the share panel
    And I publish the page from the share panel
    Then the comments toggle is on
