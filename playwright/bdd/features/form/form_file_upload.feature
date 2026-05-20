Feature: Form Files & Media upload (Phase-2)

  # End-to-end coverage of the public form's Files/Media respondent
  # input. Each scenario exercises the full backend round-trip:
  #
  #   1. Respondent clicks Upload → frontend calls
  #      `POST /api/workspace/public-form/{token}/upload-url`
  #   2. Frontend PUTs the body to the presigned URL (MinIO in dev).
  #   3. Submit posts the answer with the new `file_id`.
  #   4. Submit handler claims the upload, builds MediaCellData, and
  #      writes the row.
  #
  # Pre-conditions for the upload pipeline: the docker-compose stack
  # must expose MinIO to the browser context. `APPFLOWY_PRESIGNED_URL_ENDPOINT`
  # rewrites the presigned host so the URL Playwright receives is
  # reachable from the page.

  Background:
    Given a Grid with a Form tab is open on a Pro workspace

  Scenario: Uploading a small file lands a row with the attachment
    # Happy path. A short text file is well under the 5 MiB cap and
    # leaves no doubt the pipeline works end-to-end.
    When I add a "Media" question
    And I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    And the public form shows the Files question

    When I attach the file "smoke-test.txt" with content "hello-files"
    Then the public form attachments list shows "smoke-test.txt" as "uploaded"

    When I submit the public form
    Then the public form confirmation page is visible

    When I switch back to the authoring tab
    Then the source grid has at least 4 rows

  Scenario: Files larger than the 5 MiB cap are rejected client-side
    # The size check runs before the upload-url round-trip — no presigned
    # URL is issued for an oversize file. The attachment row surfaces an
    # error so the respondent can see why nothing was attached.
    When I add a "Media" question
    And I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    When I attempt to attach a "6000000" byte file named "too-big.bin"
    Then the public form attachments list shows "too-big.bin" as "error"

  Scenario: Removing a pending error attachment clears the row
    # The error row is a UI marker, not a server-side commitment. The
    # respondent should be able to dismiss it and try a different file.
    When I add a "Media" question
    And I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    When I attempt to attach a "6000000" byte file named "too-big.bin"
    Then the public form attachments list shows "too-big.bin" as "error"
    When I remove the attachment "too-big.bin"
    Then the public form attachments list is empty
