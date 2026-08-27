@sidebar-drop-indicator
Feature: Sidebar drop indicator marks the real landing spot
  Dropping a page below an expanded page lands it after that page *and its
  children*. The indicator used to be drawn inside the page's own name row, so
  it appeared between the page and its first child — pointing at a position the
  drop would never produce.

  Background:
    Given the sidebar drag user is signed in

  Scenario: The indicator clears the expanded children of the page it lands after
    Given a page "Drag Me" in the sidebar
    And a page "Landing Zone" in the sidebar with the child "Nested Child"
    And "Landing Zone" is expanded
    When "Drag Me" is dragged over the bottom of "Landing Zone" without dropping
    Then the drop indicator is attached to "Landing Zone"
    And the drop indicator sits below the expanded children of "Landing Zone"
    And the drop indicator does not sit at the bottom of the "Landing Zone" name row
    When the drag is released
    Then the sidebar lists "Landing Zone, Drag Me" in that order

  Scenario: A page with no children keeps the indicator on its own row
    Given a page "Solo Drag" in the sidebar
    And a page "Solo Target" in the sidebar
    When "Solo Drag" is dragged over the bottom of "Solo Target" without dropping
    Then the drop indicator is attached to "Solo Target"
    And the drop indicator sits at the bottom of the "Solo Target" name row
    When the drag is released
    Then the sidebar lists "Solo Target, Solo Drag" in that order

  Scenario: Dropping on the center of a document makes the page its child
    Given a page "Drag Me Into Parent" in the sidebar
    And a page "Drop Parent" in the sidebar with the child "Existing Child"
    And "Drop Parent" is expanded
    When "Drag Me Into Parent" is dragged into the center of "Drop Parent" without dropping
    Then "Drop Parent" is the active child drop target
    When the drag is released
    Then "Drag Me Into Parent" is a direct child of "Drop Parent"
    When the sidebar drag app is reloaded
    Then "Drag Me Into Parent" is a direct child of "Drop Parent"
