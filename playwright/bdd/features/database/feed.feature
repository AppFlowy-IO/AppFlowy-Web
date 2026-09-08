Feature: Feed

  Scenario: Feed row document content is visible in linked feed
    Given the Feed test app is initialized
    When the Feed user signs in anonymously
    Then the Feed user sees the home page with get started page

    # Verify row document content appears in feed page first
    When the user creates a new page named "FeedSource" with feed layout
    And the user clicks the first feed card to open the row detail page
    And the user adds feed row document content "Feed row document content"
    And the user closes the feed row detail page
    Then the first feed card shows row document content "Feed row document content"

    # Then verify linked feed in a normal document
    When the user creates a new document named "FeedLinkDoc" for the feed test
    And the user inserts a linked feed "FeedSource" via slash menu
    Then the linked feed shows row document content "Feed row document content"
