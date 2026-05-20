Feature: Form Respondent Identity Stamping

  # Regression target — image #48: every submission was stamped as
  # `Anonymous` even though the form was Workspace tier, because the
  # Anonymous toggle was inadvertently left ON. After the
  # `setTier` fix (Public → Workspace resets `anonymous=false`),
  # signed-in workspace members get their identity stamped on the
  # Respondent column instead of the nil-UUID sentinel.
  #
  # Submission MUST happen on the same BrowserContext as the
  # authoring tab so the cookies carry the user's GoTrue session.
  # A fresh context would 401 against a Workspace-tier form
  # (`auth_required`), which is what `form_share_access_levels`
  # covers separately.

  Scenario: Workspace-tier identified submission stamps the workspace member as Respondent
    Given a Grid with a Form tab is open on a Pro workspace

    # The default mint posture is Workspace tier + anonymous=false
    # (`coerce_anonymous` on the cloud, mirrored by the FE defaults),
    # so we don't need to touch the popover before submitting.
    # Add a Text question so the public form has something to fill.
    When I add a "RichText" question

    # Capture the share URL out of the popover, then open it in a
    # SAME-context tab — that path carries the authoring user's
    # session, which is what causes the cloud to identify the
    # respondent.
    When I open the share popover
    And I copy the share URL from the popover
    And I open the share URL in the same context

    Then the public form body is visible
    When I fill the first text input with "respondent-identity-check"
    And I submit the public form
    Then the public form confirmation page is visible

    # Back in the authoring Grid, the row for our submission must
    # carry a non-Anonymous Respondent value. We don't pin the exact
    # name (it depends on the test user's GoTrue profile) — the
    # contract we lock in is "NOT the anonymous sentinel".
    When I switch back to the authoring tab
    Then the respondent for the row with name "respondent-identity-check" is identified

  Scenario: Public-tier anonymous submission stamps the row as Anonymous
    # The reciprocal of the identified path. Public tier forces
    # `anonymous=true` (cloud's `coerce_anonymous`), and a fresh
    # BrowserContext means the submission carries no session — the
    # cloud stamps the row with the nil-UUID sentinel, which the
    # grid renders as "Anonymous". Both pieces (Public forcing
    # anonymous, no session) are required for this path — covering
    # them together protects the contract that a Public form NEVER
    # leaks the respondent's identity even if their browser happens
    # to be signed in elsewhere.
    Given a Grid with a Form tab is open on a Pro workspace
    When I add a "RichText" question

    When I open the share popover
    And I switch the share tier to "public"
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab

    Then the public form body is visible
    When I fill the first text input with "anon-respondent-check"
    And I submit the public form
    Then the public form confirmation page is visible

    When I switch back to the authoring tab
    Then the respondent for the row with name "anon-respondent-check" is anonymous
