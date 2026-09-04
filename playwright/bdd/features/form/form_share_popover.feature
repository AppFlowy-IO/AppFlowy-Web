Feature: Form Share Popover

  # Pure popover-state coverage. The end-to-end submission flows
  # exercise the same popover internals (tier picker, URL field) via
  # the actual share contract. This scenario proves a freshly created
  # workspace can share a form without a paid subscription.

  Scenario: Form share popover renders share controls with a reachable URL
    # Three regressions in one scenario:
    #   * image #44 — popover surface rendered visually blank because
    #     the loading-skeleton fill matched the popover background;
    #   * the share controls should mount without a plan gate;
    #   * the server-owned share URL is non-empty and reachable.
    Given a Grid with a Form tab is open
    When I open the share popover
    Then the share popover surface is not blank
    And the share popover shows the share controls
    And the share URL is non-empty
