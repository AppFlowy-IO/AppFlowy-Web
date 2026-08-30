@publish-comments-default
Feature: Comments default to off and are preserved across republish
  New publications must not accept public comments unless the publisher turns
  comments on. Unpublishing and republishing must keep the publisher's last
  comments setting instead of resetting it. The backend owns the default and
  durable value so the same state is used in every browser.

  Background:
    Given a blank document page is open

  Scenario: Republishing keeps comments disabled when they were never enabled
    When I type "Comments disabled doc" in the editor
    And I publish the page from the share panel
    Then the comments toggle is off
    When I unpublish the page from the share panel
    And I publish the page from the share panel
    Then the comments toggle is off

  Scenario: Republishing keeps comments disabled after they are turned off
    When I type "Comments explicitly disabled doc" in the editor
    And I publish the page from the share panel
    And I turn the comments toggle on
    And I turn the comments toggle off
    Then the comments toggle is off
    When I unpublish the page from the share panel
    And I close and reopen the publish panel
    And I publish the page from the share panel
    Then the comments toggle is off

  Scenario: Republishing keeps comments enabled when they were enabled before
    When I type "Comments preserved doc" in the editor
    And I publish the page from the share panel
    And I turn the comments toggle on
    Then the comments toggle is on
    When I unpublish the page from the share panel
    And I close and reopen the publish panel
    And I publish the page from the share panel
    Then the comments toggle is on

  Scenario: Comment panel visibility follows the toggle across browser tabs
    When I type "Cross-tab comments doc" in the editor
    And I publish the page from the share panel
    And I turn the comments toggle on
    And I open the published page in another tab
    Then the published comment panel is visible
    When I turn the comments toggle off
    Then the published comment panel is hidden
