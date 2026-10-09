Feature: Database side peek lifecycle

  How the row peek enters and leaves the page: a row deep link opens it on
  load, "Open as full page" promotes it to the row page and browser back
  returns without a peek, a published database opens rows as full pages and
  never offers the peek's "Open in a new tab" action, leaving through the
  sidebar saves an unsaved title, a related-row peek navigates the related
  database's rows, and an inline database inside the peeked row document
  takes over the peek once the outer title is saved.

  Scenario: A row deep link opens the row as a side peek on load
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Deep Link" with rows "Amber, Birch, Cedar"
    When I open the row "Birch" in the peek via its deep link
    Then the peek is open in side mode showing "Birch"
    And the peek has no backdrop
    And the visible rows are "Amber, Birch, Cedar"
    And the previous row button is enabled
    And the next row button is enabled
    When I navigate to the next row with the button
    Then the peek shows the title "Cedar"

  Scenario: Open as full page navigates to the row page and browser back returns without a peek
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Full Page" with rows "Amber, Birch, Cedar"
    When I open the row "Birch" in the peek from the grid
    And I switch the open row to "Open as full page"
    Then the full row page for "Birch" is open
    When I go back in the browser history
    Then the database page is open without a row page
    And no peek is open
    And the visible rows are "Amber, Birch, Cedar"

  Scenario: A published database opens rows as full pages without the peek's new-tab action
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Published" with rows "Amber, Birch, Cedar"
    When I publish the grid page
    And I open the published grid
    And I open the published row "Birch"
    Then the full row page for "Birch" is open
    And the published row page offers no peek actions

  Scenario: Leaving through the sidebar saves an unsaved title edit
    Given I am signed in for side peek testing
    And I have created a document page named "Peek Elsewhere"
    And I have created a grid named "Peek Sidebar Leave" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    And I set the peek title to "Amber draft"
    And I open the page "Peek Elsewhere" from the sidebar
    Then no peek is open
    When I open the page "Peek Sidebar Leave" from the sidebar
    Then the grid page "Peek Sidebar Leave" is open
    And the visible rows are "Amber draft, Birch, Cedar"
    When I reload the database page
    Then the visible rows are "Amber draft, Birch, Cedar"
    When I open the row "Amber draft" in the peek from the grid
    Then the peek shows the title "Amber draft"

  Scenario: Previous and next inside a related-row peek follow the related database
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Tasks" with rows "Task 1, Task 2, Task 3"
    And I have created a grid named "Peek Projects" with rows "Alpha, Beta, Gamma"
    And the grid has a relation property named "Linked tasks" to the grid "Peek Tasks"
    And the row "Alpha" links to "Task 2" in its "Linked tasks" property
    When I open the row "Alpha" in the peek from the grid
    And I open the related row "Task 2" from the "Linked tasks" property in the peek
    Then the peek is open in side mode showing "Task 2"
    And the previous row button is enabled
    And the next row button is enabled
    When I navigate to the next row with the button
    Then the peek shows the title "Task 3"
    And the next row button is disabled
    When I navigate to the previous row with the shortcut
    Then the peek shows the title "Task 2"
    And the peek navigation order is "Task 1, Task 2, Task 3"

  Scenario: An inline database row opened inside the peeked row replaces the peek after saving its title
    Given I am signed in for side peek testing
    And I have created a grid named "Peek Inline Host" with rows "Amber, Birch, Cedar"
    When I open the row "Amber" in the peek from the grid
    And I insert an inline grid into the peek document
    And I name the first row of the inline grid in the peek "Inner task"
    And I set the peek title to "Amber draft"
    And I open the first row of the inline grid in the peek
    Then the peek is open in side mode showing "Inner task"
    When I close the peek with the close button
    Then no peek is open
    And the visible rows are "Amber draft, Birch, Cedar"
    When I reload the database page
    Then the visible rows are "Amber draft, Birch, Cedar"
