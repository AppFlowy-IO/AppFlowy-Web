@presentation-live @pro
Feature: Paid presentations persist through the real Gateway and Cloud
  A signed-in workspace member can create, reopen, revise and export a paid presentation.
  The browser uses the configured localhost services without mocked requests or injected state.

  Scenario: A custom thirteen-slide deck survives reload, regeneration and PowerPoint export
    Given the test user signs in through the UI to the confirmed paid presentation workspace
    And the test user creates a task-owned presentation source document in the editor
    When the test user generates a custom 13 slide presentation through the UI
    Then the real Gateway returns a saved 13 slide deck from a successful Cloud job
    When the test user reloads the page and opens that saved presentation from Share
    Then the same saved artifact and version are displayed without another generation
    When the test user edits the first story title and saves and regenerates the presentation
    Then the same artifact has a newer version containing the edited story title
    When the test user exports the saved presentation and downloads PowerPoint
    Then the downloaded file contains 13 editable PowerPoint slides
    And the paid workflow leaves the workspace Free slide and export allowances unchanged
