@document-file-import
Feature: Import generated documents through the web application
  PDF and Word imports create a durable page whose rendered content matches the source file.
  These scenarios use the real import API, object storage, worker and editor without mocked responses.
  Contents use a native navigable outline; nested lists retain their hierarchy.
  The source figure must load at its exact dimensions and match every RGBA channel.

  Scenario Outline: Import a generated <format> document and reopen its content
    Given I am signed in for document file import
    When I upload the generated "<format>" fixture through the import dialog
    Then the document import completes and opens its page
    And the imported document renders the fixture content
    And the imported document displays the exact source image
    When I reload and reopen the imported document from the sidebar
    Then the imported document renders the fixture content
    And the imported document displays the exact source image

    Examples:
      | format |
      | pdf    |
      | docx   |
