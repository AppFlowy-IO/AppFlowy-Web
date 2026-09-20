@timeline @cloud
Feature: Timeline view integration
  A timeline is a first-class database layout everywhere a calendar is: it can
  be created as a page, embedded in a document (new or linked), opened in the
  page modal, and published.

  Scenario: New page menu creates a timeline page
    Given I am signed in to a fresh workspace
    When I add a Timeline page from the sidebar
    Then the timeline view renders with an empty canvas and a New row footer
    And the view tab is a Timeline tab

  Scenario: The slash menu embeds a new timeline in a document
    Given I am signed in to a fresh workspace
    And I am editing a new document
    When I insert a Timeline through the slash menu
    Then the timeline opens in the page modal
    When I close the timeline page modal
    Then the document contains a timeline block

  Scenario: The slash menu links an existing database as a timeline
    Given I am signed in to a fresh workspace
    And a timeline page exists
    And I am editing a new document
    When I link the timeline database as a timeline through the slash menu
    Then the document contains a timeline block titled "View of New Database"

  Scenario: A published timeline page renders read-only for visitors
    Given a cloud calendar with "Design" today and "Build" in 2 days
    And a Timeline view is added from the view menu
    When I publish the timeline page
    And a visitor opens the published timeline
    Then the visitor sees the "Design" and "Build" bars without editing controls
