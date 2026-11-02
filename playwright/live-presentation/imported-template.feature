@template
Feature: Reusable imported PowerPoint templates
  Scenario: A saved imported template can be selected on another page without uploading again
    Given the test user signs in through the UI to the confirmed paid presentation workspace
    When the test user uploads and reviews the template fixture on a new page
    Then the saved template is immediately selectable in the presentation dialog
    When the test user selects that template on another new page
    Then reopening the second page restores the same reviewed template without another upload
