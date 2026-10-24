@local-ref-pages
Feature: Page reference labels in Nathan's existing local workspace
  Reuse the existing Ref Pages Test space without creating or changing content,
  memberships, permissions, or trash. Annie must not be a member of the
  Ref Pages Test - Restricted space, and Trash ref target must remain in Trash.

  Run against the local server with REF_PAGES_TEST_PASSWORD set to the shared
  test-account password:
    pnpm exec bddgen test -c playwright.bdd.config.ts
    RUN_REF_PAGES_TEST=1 BASE_URL=http://localhost:3000 pnpm exec playwright test -c playwright.bdd.config.ts --grep @local-ref-pages --workers=1 --retries=0 --trace=off

  Scenario: The same stored references show the correct state for each viewer
    Given Nathan and Annie open the existing local reference page in separate signed-in sessions
    Then the existing reference elements show these labels
      | viewer | reference  | label                 |
      | Nathan | restricted | Restricted ref target |
      | Annie  | restricted | No access             |
      | Nathan | trashed    | Page in Trash         |
      | Annie  | trashed    | Page in Trash         |
      | Nathan | missing    | Page not found        |
      | Annie  | missing    | Page not found        |
    When both viewers reload the existing reference page
    Then the same reference labels are still visible
    And both viewers can inspect the existing missing reference
    When Nathan and Annie click their restricted page references
    Then Nathan opens the restricted target while Annie stays on the shared reference page
    And Annie sees an explanation of the restricted reference
    When both viewers open Trash from the existing trashed reference
    Then both viewers see the recoverable target in Trash
    When Nathan opens the shared page with a temporary reference request failure
    Then Retry loads the real target metadata and restores navigation
