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
    Given a Grid with a Form tab is open
    When I open the share popover
    Then the share popover shows the upgrade prompt
    And the share popover does not show the loading skeleton

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
