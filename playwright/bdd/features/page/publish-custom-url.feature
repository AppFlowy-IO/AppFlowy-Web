@publish-custom-url
Feature: Custom publish path name is preserved across republish
  Regression coverage for a user-reported bug: after publishing a page and
  giving it a custom URL path name, unpublishing and publishing the page again
  ("republish") must keep the custom path name. Today the custom path is lost and
  the URL reverts to the auto-generated default (a page-name + page-id suffix),
  which breaks links people have already saved.

  Background:
    Given a blank document page is open

  Scenario: Republishing keeps the custom publish path name
    When I type "Getting started guide" in the editor
    And I publish the page from the share panel
    And I change the publish path name to "getting-started-with-appflowy"
    Then the publish path name is "getting-started-with-appflowy"
    When I unpublish the page from the share panel
    And I publish the page from the share panel
    Then the publish path name is "getting-started-with-appflowy"
