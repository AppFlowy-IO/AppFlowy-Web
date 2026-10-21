Feature: Database side peek in a locked document

  Page locking lives on documents, so each scenario hosts its grid in a
  document as a linked grid. The lock reaches the embedded rows: the peek keeps
  the title, properties and document read-only and hides the row actions in
  side peek, center peek and the full row page. Unlocking the document frees
  the peek that is already open.

  Scenario: A locked document keeps the embedded grid row read-only in side and center peek
    Given I am signed in for side peek testing
    And I have created a grid named "Locked Grid" with rows "Amber, Birch, Cedar"
    And the grid has a text property named "Notes"
    And I have created a document named "Locked Host" with a linked grid "Locked Grid"
    When I open the row "Amber" in the peek from the grid
    And I set the "Notes" text property in the peek to "Protected notes"
    And I append "Protected document" to the peek document
    And I close the peek with the close button
    And I lock the current page from the header
    And I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek is read-only
    And the peek document contains "Protected document"
    When I try to type "Locked edit" into the peek title
    And I try to type "Locked edit" into the "Notes" property in the peek
    And I try to type "Locked edit" into the peek document
    Then the peek shows the title "Amber"
    And the "Notes" property in the peek shows "Protected notes"
    And the "Notes" property in the peek does not contain "Locked edit"
    And the peek document does not contain "Locked edit"
    When I switch the open row to "Center peek"
    Then the peek is open in center mode showing "Amber"
    And the peek is read-only
    And the peek document contains "Protected document"
    When I switch the open row to "Side peek"
    Then the peek is open in side mode showing "Amber"
    And the peek is read-only
    When I close the peek with the close button
    And I reload the database page
    Then the grid cell "Notes" of row "Amber" contains "Protected notes"
    When I open the row "Amber" in the peek from the grid
    Then the peek is read-only
    And the peek document contains "Protected document"
    And the peek document does not contain "Locked edit"

  Scenario: Unlocking the document makes the open side peek editable without reopening it
    Given I am signed in for side peek testing
    And I have created a grid named "Unlock Grid" with rows "Amber, Birch, Cedar"
    And the grid has a text property named "Notes"
    And I have created a document named "Unlock Host" with a linked grid "Unlock Grid"
    When I lock the current page from the header
    And I open the row "Amber" in the peek from the grid
    Then the peek is open in side mode showing "Amber"
    And the peek is read-only
    When I unlock the current page from the header
    Then the peek is open in side mode showing "Amber"
    And the peek is editable
    When I set the peek title to "Amber unlocked"
    And I set the "Notes" text property in the peek to "Unlocked note"
    And I append "Unlocked document" to the peek document
    And I close the peek with the close button
    And I reload the database page
    Then the grid cell "Notes" of row "Amber unlocked" contains "Unlocked note"
    When I open the row "Amber unlocked" in the peek from the grid
    Then the peek is editable
    And the peek document contains "Unlocked document"

  # "Full page" leaves the locked document for the source database's own
  # row page (?r=), whose access follows that database page, not the document
  # lock; the peek inside the document is what the lock keeps read-only.
  Scenario: Opening a locked document's embedded grid row as a full page follows the source database's access
    Given I am signed in for side peek testing
    And I have created a grid named "Full Page Grid" with rows "Amber, Birch, Cedar"
    And I have created a document named "Full Page Host" with a linked grid "Full Page Grid"
    When I open the row "Amber" in the peek from the grid
    And I append "Protected document" to the peek document
    And I close the peek with the close button
    And I lock the current page from the header
    And I open the row "Amber" in the peek from the grid
    Then the peek is read-only
    When I switch the open row to "Full page"
    Then the full row page for "Amber" is open
    And the full row page document contains "Protected document"
    And the full row page is editable
