Feature: Export a document page to PDF
  The exported PDF is named after the page. A page whose title was cleared is
  shown as "Untitled", so its PDF must be saved as "Untitled.pdf" rather than
  as a nameless ".pdf" file.

  Scenario: A page whose title was cleared exports as Untitled.pdf
    Given a signed-in user has a document page titled "Draft title" for PDF export
    When I clear the page title
    And I export it to PDF from the Share menu
    Then the downloaded PDF is named "Untitled.pdf"
