Feature: Form Share Settings (Anonymous + Submission Access)

  # Covers the popover's two state-shaping toggles besides tier:
  #
  #   * Anonymous (`useFormShare.setAnonymous`) — auto-promotes the
  #     tier from Workspace → Public when flipped ON, mirroring the
  #     desktop's `setAnonymous` rule.
  #   * Submission access (`setSubmissionAccess`) — `none` vs `view`;
  #     the row is only mounted when `tier === 'workspace' &&
  #     !anonymous` because the cloud's `coerce_submission_access`
  #     forces `'none'` otherwise. Hiding the row server-side AND on
  #     the UI keeps the two clients honest.
  #
  # All scenarios start on a Pro workspace because the cloud's mint
  # gate refuses Free workspaces (covered separately by
  # `form_share_popover.feature`).

  Background:
    Given a Grid with a Form tab is open on a Pro workspace

  Scenario: Toggling Anonymous ON under Workspace auto-promotes the tier to Public
    When I open the share popover
    Then the access banner reflects the "workspace" tier
    And the access banner reports anonymous responses as "false"

    When I toggle the Anonymous switch
    # `setAnonymous(true)` under workspace tier promotes to public AND
    # forces submission_access to `none`. Both bits should now reflect.
    Then the access banner reflects the "public" tier
    And the access banner reports anonymous responses as "true"
    And the access banner reports submission access as "none"

  Scenario: Submission access "view" is coerced to "none" by the cloud
    # The cloud's `supported_submission_access` (`share.rs:86`) currently
    # always returns `FormSubmissionAccess::None` — `view` was scoped
    # out of the V1 backend. The FE happily sends `submission_access:
    # 'view'`, the cloud accepts the patch, but stores `none`. This
    # scenario locks in the contract so the next person who reads it
    # knows the FE row isn't broken — the cloud just doesn't honour
    # `view` yet.
    When I open the share popover
    And I pick "view" for submission access
    Then the access banner reports submission access as "none"

  Scenario: Submission access row hides under Public tier
    # `showSubmissionAccess = tier === 'workspace' && !anonymous` —
    # picking Public flips `tier === 'public'` so the row should
    # disappear from the popover entirely.
    When I open the share popover
    And I switch the share tier to "public"
    Then the submission access row is not visible
