Feature: Form Share UI Rules

  # Notion-parity decoupling (image #51): the Anonymous toggle controls
  # the anonymous flag, the picker controls the tier, neither side
  # bleeds into the other. Workspace + Anonymous is a valid persistent
  # combination — workspace members submit but their identity is not
  # recorded in the Respondent column (anonymous team-survey case).
  #
  # Previous iterations of this scenario asserted on a tier auto-promote
  # rule (toggling Anonymous ON under Workspace flipped tier to Public)
  # and a Public→Workspace reset (which preserved `anonymous=true`).
  # Both rules were dropped to match Notion; these scenarios lock in
  # the decoupled contract.

  Background:
    Given a Grid with a Form tab is open on a Pro workspace

  Scenario: Toggling Anonymous ON under Workspace does NOT auto-promote tier
    When I open the share popover
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

    When I toggle the Anonymous switch
    # Tier stays Workspace — the toggle controls only the anonymous
    # flag. Image #48 confusion came from auto-promoting to Public;
    # that rule is removed.
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "true"

    # Toggling back also stays on Workspace.
    When I toggle the Anonymous switch
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

  Scenario: Public tier forces anonymous=true and preserves the flag back to Workspace
    When I open the share popover

    # Switch to Public — cloud forces anonymous=true client-side and
    # server-side. Mirrors the cloud's `coerce_anonymous` for Public.
    When I switch the share tier to "public"
    Then the access banner reflects the "public" tier
    And the access banner reports anonymous responses as "true"
