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

  Scenario: Feed card displays linked grid database correctly with proper height
    Given the Feed test app is initialized
    When the Feed user signs in anonymously
    And the Feed user creates a source grid named "TestGrid"
    And the user creates a new page named "TestFeed" with feed layout
    And the user clicks the first feed card to open the row detail page
    And the Feed user inserts paragraphs and a linked grid "TestGrid" in the row document
    And the user closes the feed row detail page
    Then the first feed card contains a linked grid with bounded expandable height

  Scenario: View database button closes row detail dialog for linked grid in row document
    Given the Feed test app is initialized
    When the Feed user signs in anonymously
    And the Feed user creates a source grid named "SourceGridForDialog"
    And the user creates a new page named "FeedForDialog" with feed layout
    And the user clicks the first feed card to open the row detail page
    And the Feed user inserts paragraphs and a linked grid "SourceGridForDialog" in the row document
    And the Feed user opens the original linked grid
    Then the Feed row detail is closed and the source grid is open

  Scenario: View database button works in normal document without dialog
    Given the Feed test app is initialized
    When the Feed user signs in anonymously
    And the Feed user creates a source grid named "SourceGridForDocument"
    And the user creates a new document named "LinkedGridDoc" for the feed test
    And the Feed user inserts a linked grid "SourceGridForDocument" in the normal document
    And the Feed user opens the original linked grid
    Then the Feed row detail is closed and the source grid is open
