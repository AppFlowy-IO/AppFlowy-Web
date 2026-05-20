Feature: Form Share End-to-End

  # Every scenario in this feature actually submits a form (or proves
  # submission is blocked) and verifies the resulting database state.
  # No chrome-only assertions live here — pure cloud-contract coverage.

  Background:
    # Pro workspace required so the cloud's `is_workspace_on_paid_plan`
    # lets the mint through. Debug builds bypass the gate anyway
    # (`plan_check.rs::is_workspace_on_paid_plan`); this Given still
    # works on a build where the bypass is off (e.g., commercial CI).
    Given a Grid with a Form tab is open on a Pro workspace

  Scenario: Workspace-tier identified submission stamps the workspace member
    # Default mint state is Workspace tier + anonymous=false, so no
    # popover changes needed before submitting. The same-context tab
    # carries the authoring user's GoTrue session — the cloud reads
    # that session and stamps the Respondent column with the member.
    When I add a "RichText" question
    And I open the share popover
    And I copy the share URL from the popover
    And I open the share URL in the same context

    Then the public form body is visible
    When I fill the first text input with "workspace-identified-check"
    And I submit the public form
    Then the public form confirmation page is visible

    When I switch back to the authoring tab
    Then the respondent for the row with name "workspace-identified-check" is identified

  Scenario: Submit another response lands a second row (idempotency key rotates)
    # Regression for the "submit again does nothing" symptom: the
    # `idempotencyKey` was initialized once on mount and reused on the
    # second submit, so the cloud's `(token, idempotency_key)` dedup
    # returned the original submission's id instead of writing a new
    # row. `handleSubmitAnother` now rotates the key.
    When I add a "RichText" question
    And I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    When I fill the first text input with "submit-another-first"
    And I submit the public form
    Then the public form confirmation page is visible

    # Click "Submit another response", fill and submit again from the
    # SAME respondent tab (same idempotency window if the key didn't
    # rotate).
    When I click submit another response
    Then the public form body is visible
    When I fill the first text input with "submit-another-second"
    And I submit the public form
    Then the public form confirmation page is visible

    # Both submissions must have landed — the source grid had 3 default
    # rows; +2 submissions = 5.
    When I switch back to the authoring tab
    Then the source grid has at least 5 rows
    And the respondent for the row with name "submit-another-first" is anonymous
    And the respondent for the row with name "submit-another-second" is anonymous

  Scenario: Public-tier anonymous submission lands as Anonymous and adds a row
    # Reciprocal of the identified path. Switching to Public forces
    # anonymous=true cloud-side; submitting from a fresh BrowserContext
    # ensures no session leaks. Both pieces required for the privacy
    # contract: Public never stamps an identified respondent even if
    # the browser is signed in elsewhere.
    When I add a "RichText" question
    And I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    When I fill the first text input with "public-anon-check"
    And I submit the public form
    Then the public form confirmation page is visible

    When I switch back to the authoring tab
    # Source grid had 3 default rows; the submission adds the 4th.
    Then the source grid has at least 4 rows
    And the respondent for the row with name "public-anon-check" is anonymous

  Scenario: Workspace-anonymous and Closed tiers block respondent submission
    # Two unsubmittable states in one scenario. The popover doesn't
    # need to change for the workspace-anon case (default mint =
    # workspace tier, anonymous responder = no session). For Closed
    # we flip the tier through the popover then re-visit the same URL.
    When I open the share popover
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab
    Then the public form shows the login required prompt

    # Now flip to Closed and reload the public URL. The existing link
    # surfaces "no longer accepting"; no new respondent row is created.
    When I switch back to the authoring tab
    And I switch the share tier to "closed"
    Then the access banner reflects the "closed" tier
    When I open the share URL in a fresh anonymous tab
    Then the public form shows the closed page
