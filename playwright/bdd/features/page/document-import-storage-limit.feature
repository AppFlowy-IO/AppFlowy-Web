@document-import-storage-limit
Feature: Explain storage limits during document import
  Controlled API responses exercise the real import dialog and file picker.
  The worker database tests separately verify the real PostgreSQL quota denial.

  Scenario Outline: Stop a document batch when the <stage> reports a storage limit
    Given I am signed in for document file import
    And the document import "<stage>" reports exhausted workspace storage
    When I select two generated "<format>" files for the storage limit check
    Then I see an actionable import storage limit prompt
    And the remaining file is not uploaded

    Examples:
      | stage   | format |
      | request | pdf    |
      | worker  | docx   |
