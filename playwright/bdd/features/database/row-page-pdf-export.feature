Feature: Export a database row page to PDF
  Share → Export as → PDF on a database row exports the row's own page, never
  the database the row belongs to (issue #545). Like Desktop, the export is
  offered on the full row page and in both row peeks. The export uses the real
  server endpoint: the downloaded file name is the server's title for the
  exported page, so it shows which page the server rendered.

  Background:
    Given a signed-in user has a new grid database for PDF export

  Scenario: A full-page row exports its row page instead of the parent grid
    Given the first grid row is titled "Quarterly report row" with page content "Row page body exported to PDF"
    And the row is opened as a full page
    When I export it to PDF from the Share menu
    Then the PDF export targets the row page, not the database
    And the downloaded PDF is named "Quarterly report row.pdf"

  Scenario: A full-page row whose page is still empty exports its row page
    Given the first grid row is titled "Empty row page"
    And the row is opened as a full page
    When I export it to PDF from the Share menu
    Then the PDF export targets the row page, not the database
    And the downloaded PDF is named "Empty row page.pdf"

  Scenario Outline: The <mode> peek exports its row page like Desktop
    Given the first grid row is titled "<title>"
    And the row is open in a <mode> peek
    When I export it to PDF from the Share menu
    Then the PDF export targets the row page, not the database
    And the downloaded PDF is named "<title>.pdf"

    Examples:
      | mode   | title              |
      | side   | Side peek export   |
      | center | Center peek export |

  Scenario: An untitled row page exports as Untitled.pdf
    Given the first grid row has no title
    And the row is opened as a full page
    When I export it to PDF from the Share menu
    Then the PDF export targets the row page, not the database
    And the downloaded PDF is named "Untitled.pdf"
