@database-row-attribution
Feature: Database row attribution
  Created by stays tied to the user who created a row, while Last edited by
  follows the most recent user who changes that row.

  Scenario: A later editor does not replace the row creator
    Given Nathan creates a renamed database row with attribution fields
    When Eva edits Nathan's database row
    Then the row shows Nathan as its creator and Eva as its last editor
