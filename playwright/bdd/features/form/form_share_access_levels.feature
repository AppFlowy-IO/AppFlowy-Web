Feature: Form Share Access Levels

  # Covers the cloud's per-tier auth posture as observed by an anonymous
  # respondent. The three tiers map to three respondent landing states
  # (see `FormView.tsx`):
  #
  #   * Workspace tier + anonymous=false → `auth_required` page
  #   * Closed tier                      → `closed` page
  #   * Public tier                      → live form (covered in
  #                                        `form_share_submit.feature`)
  #
  # All scenarios start on a Pro workspace because the cloud's
  # `is_workspace_on_paid_plan` gate blocks the mint on Free workspaces.

  Background:
    Given a Grid with a Form tab is open on a Pro workspace

  Scenario: Anonymous respondent on a workspace-tier form sees the login prompt
    # Default tier is workspace + anonymous=false (cloud `coerce_anonymous`
    # forces false for Workspace tier per `share.rs`). An anonymous
    # respondent should be funneled through login, not through the form.
    When I open the share popover
    And I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab
    Then the public form shows the login required prompt

  Scenario: Closed tier returns the "no longer accepting" page
    When I open the share popover
    And I switch the share tier to "closed"
    Then the access banner reflects the "closed" tier
    When I copy the share URL from the popover
    And I open the share URL in a fresh anonymous tab
    Then the public form shows the closed page
