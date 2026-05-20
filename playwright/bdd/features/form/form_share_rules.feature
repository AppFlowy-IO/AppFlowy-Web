Feature: Form Share UI Rules

  # FE-side invariants that the popover enforces on top of the cloud's
  # contracts. The chain walks four rules in one scenario so the
  # transition graph is exercised end-to-end:
  #
  #   1. Toggle Anonymous ON under Workspace tier → auto-promotes to
  #      Public (and forces submission_access=none).
  #   2. Switch tier from Public back to Workspace → anonymous resets
  #      to false. Regression target for image #48 where workspace
  #      submissions were being stamped as Anonymous because anon=true
  #      leaked across the Public→Workspace transition.
  #   3. Pick "Can view" for submission access → cloud's
  #      `supported_submission_access` always coerces to `None`, so
  #      the banner attribute should still read `none`.
  #   4. Switch tier to Public → submission access row unmounts (the
  #      cloud forces `none` under Public, so the FE hides the row to
  #      match the contract).

  Scenario: Share popover invariants — anonymous promote, tier reset, access coerce, row hide
    Given a Grid with a Form tab is open on a Pro workspace
    When I open the share popover
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

    # Rule 1 — Anonymous toggle ON under Workspace auto-promotes.
    When I toggle the Anonymous switch
    Then the access banner reflects the "public" tier
    And the access banner reports anonymous responses as "true"
    And the access banner reports submission access as "none"

    # Rule 2 — Public → Workspace resets anonymous.
    When I switch the share tier to "workspace"
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

    # Rule 3 — Submission access "view" coerced by cloud to "none".
    When I pick "view" for submission access
    Then the access banner reports submission access as "none"

    # Rule 4 — Submission access row hides under Public tier.
    When I switch the share tier to "public"
    Then the submission access row is not visible
