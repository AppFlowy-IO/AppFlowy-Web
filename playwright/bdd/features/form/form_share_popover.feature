Feature: Form Share Popover

  # Covers the full share-popover state machine:
  #
  #   * Free workspace → `errorKind: 'plan_required'` → upgrade prompt
  #     (regression image #41 — previously stuck on infinite skeleton).
  #   * Pro workspace → share rows render, tier transitions persist,
  #     share URL becomes copyable.
  #
  # Pro scenarios seed `af_workspace_subscription` via psql so the
  # cloud's `is_workspace_on_paid_plan` gate doesn't refuse the mint.
  # Free scenarios deliberately skip the seed to assert the upgrade
  # path stays correct.

  Scenario: Free workspace sees the upgrade prompt instead of the share rows
    # The cloud's `is_workspace_on_paid_plan` short-circuits to true
    # for debug builds (`plan_check.rs`), so the natural test path is
    # gone in dev. This scenario route-mocks the form-share endpoints
    # to return FeatureNotAvailable so the FE's `plan_required`
    # classifier branch still has coverage.
    Given a Grid with a Form tab is open on a simulated Free workspace
    When I open the share popover
    Then the share popover shows the upgrade prompt
    And the share popover does not show the loading skeleton

  Scenario: Share popover never renders a blank surface
    # Regression for image #44 — the loading skeleton used a fill color
    # that matched the popover background in dark mode, so users saw
    # an empty rectangle for the whole retry window. This scenario
    # opens the popover immediately after the form view is created (so
    # the bootstrap is likely mid-retry) and asserts the popover
    # surface always carries human-readable copy — either the loading
    # text, the upgrade copy, the error copy, or the share controls.
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    Then the share popover surface is not blank

  Scenario: Pro workspace sees the share rows after the popover bootstraps
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    Then the share popover shows the share controls
    And the share URL is non-empty

  Scenario: Switching to Public tier exposes a copyable share URL
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    And I switch the share tier to "public"
    Then the access banner reflects the "public" tier
    And the share URL is non-empty
