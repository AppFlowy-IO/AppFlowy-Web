Feature: Export a database to PDF with readable paper settings
  Like Desktop (AppFlowy-Premium #1545, AppFlowy#9106), Share → Export as → PDF
  on a database page exports the tab on screen, with that tab's visible fields,
  and lets the user pick the paper (A4, A3, Letter or Legal) and orientation for
  this export. The server continues wide tables on further pages, repeating the
  name column, instead of shrinking every column onto one page. These options
  belong to one export and never change the database view. Desktop suggests the
  tab's name in its save dialog; Web downloads directly, so the file keeps the
  database page's name.

  Background:
    Given a signed-in user has a new grid database for PDF export

  Scenario: A database export offers paper options instead of linked pages
    When I open Export as from the database Share menu
    Then the PDF export offers the paper sizes "A4, A3, Letter, Legal" with "A4" selected
    And the PDF export is in portrait
    And the PDF export does not offer "Include linked pages"

  Scenario: A database exports on A4 portrait unless the user chooses otherwise
    When I open Export as from the database Share menu
    And I export the database to PDF
    Then the PDF export requests "a4" paper in portrait
    And the downloaded PDF is named "New Database.pdf"

  Scenario Outline: The paper and orientation chosen for one export reach the server
    When I open Export as from the database Share menu
    And I choose <paper> paper in <orientation>
    And I export the database to PDF
    Then the PDF export requests "<page_size>" paper in <orientation>
    And the downloaded file is a PDF

    Examples:
      | paper  | page_size | orientation |
      | A3     | a3        | landscape   |
      | Letter | letter    | landscape   |
      | Legal  | legal     | portrait    |

  Scenario: A database exports the tab on screen with that tab's fields
    Given the database has a Gallery tab, which shows only the name field
    When I open Export as from the database Share menu
    And I export the database to PDF
    Then the PDF export targets the Gallery tab, not the first Grid tab
    And the exported PDF has the column "Name" and none of the grid's other columns
    And the downloaded PDF is named "New Database.pdf"
    When I switch to the Grid tab
    And I open Export as from the database Share menu
    And I export the database to PDF
    Then the PDF export targets the Grid tab
    And the exported PDF has every column of the grid

  # The server names the file after the exported tab ("Grid"); a page whose
  # title was cleared must still download as the "Untitled" page it shows.
  Scenario: A database page without a title exports as Untitled.pdf
    When I clear the database page title
    And I open Export as from the database Share menu
    And I export the database to PDF
    Then the PDF export requests "a4" paper in portrait
    And the downloaded PDF is named "Untitled.pdf"

  # Desktop's mixed-field check: a tick and a select tag stay beside their row.
  Scenario: Ticks and select tags stay beside their own rows
    Given the first and third rows are checked and every row has its own Status tag
    When I open Export as from the database Share menu
    And I export the database to PDF
    Then the downloaded PDF shows ticks and Status tags beside their own rows only

  # Desktop's twenty-column fixture. Needs AppFlowy-Cloud-Premium#1539, which
  # renders database views in readable column bands on the chosen paper. Opt in
  # with RUN_CLOUD_DATABASE_PDF_LAYOUT=1 until CI's Cloud image includes it.
  @cloud-database-pdf-layout
  Scenario Outline: A twenty-column database exports readable <paper> <orientation> pages
    Given the database has 20 columns and 16 rows of distinct values written through the server
    When I open Export as from the database Share menu
    And I choose <paper> paper in <orientation>
    And I export the database to PDF
    Then every page of the downloaded PDF is <paper> paper in <orientation>
    And the downloaded PDF has every cell beside its row name, continuing columns on more pages

    Examples:
      | paper | orientation |
      | A4    | portrait    |
      | A3    | landscape   |
