@inline-comment
Feature: Document inline comments
  Ported from the desktop BDD tests inline_comment.feature,
  cloud_new_page_comments_panel.feature and
  cloud_row_page_inline_comment.feature. A selection in a document can be
  commented on from the selection toolbar; the comment thread lives in the
  comments panel where it can be replied to, resolved, reopened and deleted.

  Background:
    Given I am signed in with a new account

  Scenario: Create, reply to, resolve, reopen and delete an inline comment
    Given I have created and opened a document for inline comments
    When I type "Columns represent different stages of the workflow." in the document
    And I select the first 7 characters in the document
    And I open the inline comment composer
    Then the inline comment composer is visible
    When I enter "Great work on the layout!" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment sidebar is visible
    And the inline comment "Great work on the layout!" is visible in the sidebar
    And the commented text is highlighted in the document
    And the inline comment "Great work on the layout!" quotes "Columns"
    When I reply to the inline comment "Great work on the layout!" with "We should add a mobile example too."
    Then the inline comment reply "We should add a mobile example too." is visible
    When I resolve the inline comment "Great work on the layout!"
    Then the inline comment "Great work on the layout!" is not visible in the sidebar
    And the commented text is no longer highlighted in the document
    When I select the "Resolved" inline comment filter
    Then the inline comment "Great work on the layout!" is visible in the sidebar
    When I reopen the inline comment "Great work on the layout!"
    And I select the "Open" inline comment filter
    Then the inline comment "Great work on the layout!" is visible in the sidebar
    And the commented text is highlighted in the document
    When I delete the inline comment "Great work on the layout!"
    Then the inline comment "Great work on the layout!" is not visible in the sidebar
    And the comments panel shows the "Open" empty state
    And the commented text is no longer highlighted in the document

  # The page modal is the first surface a new page opens in, so the selection
  # toolbar there must offer the same comment entry point as the full page.
  Scenario: Comment on a page opened in the page modal
    Given I have created a document that stays open in the page modal
    When I type "Modal pages accept inline comments." in the page modal document
    And I select the first 5 characters in the document
    Then the inline comment action is visible in the selection toolbar
    When I open the inline comment composer
    And I enter "Comment from the page modal" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment sidebar is visible
    And the inline comment "Comment from the page modal" is visible in the sidebar
    And the commented text is highlighted in the page modal document
    When I close the comments panel
    And I close the page modal
    Then inline commenting remains active for the routed document

  Scenario: An inline comment and its anchor survive a reload
    Given I have created and opened a document for inline comments
    When I type "Persisted anchors keep the thread visible." in the document
    And I select the first 9 characters in the document
    And I open the inline comment composer
    And I enter "Still here after reload" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment "Still here after reload" is visible in the sidebar
    When I open the page in a clean browser context and open the comments panel
    Then the commented text is highlighted in the document
    And the inline comment "Still here after reload" is visible in the sidebar

  Scenario: React to a comment and focus its thread from the commented text
    Given I have created and opened a document for inline comments
    When I type "Reactions keep the discussion readable." in the document
    And I select the first 9 characters in the document
    And I open the inline comment composer
    And I enter "Please review this wording" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment "Please review this wording" is visible in the sidebar
    When I add the "👍" reaction to the inline comment "Please review this wording"
    Then the inline comment "Please review this wording" shows the "👍" reaction with count 1
    When I remove the "👍" reaction from the inline comment "Please review this wording"
    Then the inline comment "Please review this wording" shows no reactions
    When I close the comments panel
    Then the comments panel is closed
    When I click the commented text in the document
    Then the inline comment sidebar is visible
    And the inline comment "Please review this wording" is focused

  # Comment permission is independent from editability: a locked page renders a
  # read-only editor but still accepts inline comments (desktop
  # getViewCanCommentStatus / comment_permission.feature).
  Scenario: A locked page is read-only but still commentable
    Given I have created and opened a document for inline comments
    When I type "Locked pages still accept comments." in the document
    And I lock the current page
    Then the document editor is read-only
    When I double-click the first word in the document
    Then the read-only inline comment trigger is available
    When I open the inline comment composer from the read-only trigger
    Then the inline comment composer is visible
    When I enter "Comment on a locked page" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment sidebar is visible
    And the inline comment "Comment on a locked page" is visible in the sidebar

  Scenario: Opening the comments panel on a newly created page reports no missing record
    Given inline comment loading is paused
    And I have created and opened a document for inline comments
    Then the comments panel is closed
    When I open the comments panel from the page header
    Then the inline comment sidebar is visible
    And the comments panel remains loading
    And no record not found error is shown
    When I resume inline comment loading
    And the comments panel shows the "Open" empty state
    And no record not found error is shown
    When I close the comments panel
    Then the comments panel is closed

  Scenario: Add an inline comment in a full-page database row document
    Given I have created a grid page named "Row Page Inline Comment Grid"
    When I set the first grid cell to "Row Comment Target"
    And I open the grid row named "Row Comment Target" as a full row page
    Then the comments panel is closed
    When I open the comments panel from the page header
    Then the inline comment sidebar is visible
    And the comments panel shows the "Open" empty state
    And no record not found error is shown
    When I close the comments panel
    And I type "Row page supports inline comments." into the row document
    And I select the first 8 characters in the document
    And I open the inline comment composer
    Then the inline comment composer is visible
    When I enter "Comment from full-page row document" in the inline comment composer
    And I submit the inline comment composer
    Then the inline comment sidebar is visible
    And the inline comment "Comment from full-page row document" is visible in the sidebar
    And the commented text is highlighted in the document
    When I open the page in a clean browser context and open the comments panel
    Then the commented text is highlighted in the document
    And the inline comment "Comment from full-page row document" is visible in the sidebar
