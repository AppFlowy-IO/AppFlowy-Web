Feature: Form Share Popover

  # Pure popover-state coverage. The end-to-end submission flows
  # exercise the same popover internals (tier picker, URL field) via
  # the actual share contract; this feature targets the two pre-submit
  # branches that don't reach the cloud:
  #
  #   * Free workspace → upgrade prompt (route-mocked because debug
  #     builds bypass the cloud's plan gate).
  #   * Pro workspace → share rows render, popover never renders a
  #     blank surface, share URL is reachable in the input.

  Scenario: Free workspace sees the upgrade prompt instead of the share rows
    # `is_workspace_on_paid_plan` short-circuits to true for debug
    # builds (`plan_check.rs`), so the natural test path is gone in
    # dev. Route-mock the form-share endpoints to return
    # FeatureNotAvailable so the FE's `plan_required` classifier
    # branch still has coverage.
    Given a Grid with a Form tab is open on a simulated Free workspace
    When I open the share popover
    Then the share popover shows the upgrade prompt
    And the share popover does not show the loading skeleton

  Scenario: Pro workspace popover renders share controls with a reachable URL
    # Three regressions in one scenario:
    #   * image #44 — popover surface rendered visually blank because
    #     the loading-skeleton fill matched the popover background;
    #   * the share controls should mount on a Pro path;
    #   * the URL the cloud composes (or the FE falls back to) is
    #     non-empty and reachable.
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    Then the share popover surface is not blank
    And the share popover shows the share controls
    And the share URL is non-empty
