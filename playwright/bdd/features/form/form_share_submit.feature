Feature: Form Share Link + Submission

  # End-to-end coverage for the respondent flow:
  #
  #   1. Author a form on a Pro workspace.
  #   2. Switch tier to Public (no auth required to submit).
  #   3. Read the share URL out of the popover.
  #   4. Open it in a fresh tab (anonymous, no cookies).
  #   5. Fill the form and submit.
  #   6. Switch back to authoring → Responses Grid → confirm a new row.
  #
  # Pro is required because the cloud's `is_workspace_on_paid_plan` gate
  # blocks the mint on Free workspaces (we cover that path in
  # `form_share_popover.feature`).

  Scenario: Public form link submission adds a row to the source database
    Given a Grid with a Form tab is open on a Pro workspace

    # Add a single text question so the public form has something to
    # fill in. The default Grid ships Name/Type/Done; the new question
    # creates an additional field on the database. The form view's
    # FormBuilderView projection points at the new field only (because
    # we dismissed the auto-create modal via Start-from-scratch in the
    # background helper).
    When I add a "RichText" question

    # Flip the share tier to Public so anonymous traffic isn't 401'd.
    When I open the share popover
    And I switch the share tier to "public"
    Then the access banner reflects the "public" tier

    # Capture the URL the popover surfaces, then open the respondent
    # surface in a tab whose context has no authoring cookies. The
    # public route auth-bypasses for Public-tier forms.
    When I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    # Fill the first text input and submit. The public form schema is
    # populated from the YJS draft (Q1 is RichText kind=`text`).
    Then the public form body is visible
    When I fill the first text input with "Hello from BDD"
    And I submit the public form
    Then the public form confirmation page is visible

    # Back in the authoring tab, the cloud's collab stream pushes the
    # new row over the YJS WebSocket → the Grid's React tree commits.
    # Wait up to 15s for the row count to grow by 1 over the pre-
    # submission baseline (3 default rows + 1 new submission = 4).
    When I switch back to the authoring tab
    Then the source grid has at least 4 rows
