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
      | Annie  | restricted | No Access             |
      | Nathan | trashed    | This page is in Trash |
      | Annie  | trashed    | This page is in Trash |
    When both viewers reload the existing reference page
    Then the same reference labels are still visible
    When Nathan and Annie click their restricted page references
    Then Nathan opens the restricted target while Annie stays on the shared reference page
