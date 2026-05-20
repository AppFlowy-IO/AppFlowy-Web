Feature: Form Share UI Rules

  # FE-side invariants that the popover enforces on top of the cloud's
  # contracts. The chain walks both rules in one scenario so the
  # transition graph is exercised end-to-end:
  #
  #   1. Toggle Anonymous ON under Workspace tier → auto-promotes to
  #      Public (and forces submission_access=none).
  #   2. Switch tier from Public back to Workspace → anonymous resets
  #      to false. Regression target for image #48 where workspace
  #      submissions were being stamped as Anonymous because anon=true
  #      leaked across the Public→Workspace transition.
  #
  # The submission-access row was removed from the popover UI because
  # the cloud's `supported_submission_access` (`share.rs:86`) hardcodes
  # to `None` — shipping the "Can view" affordance was misleading.
  # The data wiring (`info.submission_access`) stays so the row can be
  # re-introduced if the cloud feature lands.

  Scenario: Share popover invariants — anonymous promote, tier reset
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

    # Rule 1 — Anonymous toggle ON under Workspace auto-promotes.
    When I toggle the Anonymous switch
    Then the access banner reflects the "public" tier
    And the access banner reports anonymous responses as "true"
    And the access banner reports submission access as "none"

    # Rule 2 — Public → Workspace resets anonymous (image #48 fix).
    When I switch the share tier to "workspace"
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"
