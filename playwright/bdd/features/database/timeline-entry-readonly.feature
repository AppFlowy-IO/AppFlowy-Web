@timeline @timeline-entry
Feature: Timeline creation and read-only interaction
  Timeline uses native database and folder layout identifiers in each entry path.
  A locked document passes the real App read-only context to its inline Timeline.

  Scenario: Create a native standalone Timeline
    Given I create a standalone Timeline from the sidebar
    Then it has the native Timeline layout and an editable date property
    And reopening the page renders the Timeline

  Scenario: Insert a Timeline through the document slash menu
    Given I insert an inline Timeline in a document
    Then it has the native Timeline layout and an editable date property
    And reopening the document renders its inline Timeline

  @readonly
  Scenario: A locked Timeline permits reading and navigation while preventing mutations
    Given I insert an inline Timeline in a document
    And that inline Timeline contains a scheduled row named Protected
    And that inline Timeline is grouped by Phase
    When I lock the document containing the Timeline
    Then Timeline creation settings resize and reorder controls are unavailable
    And expanding a read-only Timeline group changes no saved settings
    And pointer and keyboard date edits leave the protected dates unchanged
    And I can navigate zoom and open the protected row in read-only mode
    And the locked Timeline remains protected after reload
