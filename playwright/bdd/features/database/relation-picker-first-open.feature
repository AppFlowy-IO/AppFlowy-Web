@relation-picker
Feature: Relation picker loads its options on the first open
  The picker reads the related database out of a doc that `loadView` hands back
  as soon as it exists locally — fields and rows can still be arriving. Reading
  it once left the list empty until the panel was closed and opened again, which
  is the workaround users were reaching for.

  Scenario: The picker lists the related database rows the first time it is opened
    Given the relation picker user is signed in
    And a picker grid "Picker Targets" with rows "Alpha, Bravo"
    And a picker grid "Picker Sources" with rows "Src One"
    And a relation property "Targets" pointing at "Picker Targets"
    When the relation cell picker is opened on row 0 for the first time
    Then the relation picker lists "Alpha, Bravo"
    And the relation picker does not say there is no result

  Scenario: A row added to the related database while the picker is open shows up without reopening
    Given the relation picker user is signed in
    And a picker grid "Live Targets" with rows "Existing One"
    And a self relation property "Related" on "Live Targets"
    When the relation cell picker is opened on row 0 for the first time
    Then the relation picker lists "Existing One"
    When a row "Arrived Late" is appended to the related database while the picker stays open
    Then the relation picker lists "Arrived Late"
    And the relation picker was never closed

  Scenario: A row title that arrives after the picker opened replaces the placeholder name
    Given the relation picker user is signed in
    And a picker grid "Late Titles" with rows "Before Rename"
    And a self relation property "Related" on "Late Titles"
    When the relation cell picker is opened on row 0 for the first time
    Then the relation picker lists "Before Rename"
    When the related row 0 is renamed to "After Rename" while the picker stays open
    Then the relation picker lists "After Rename"
    And the relation picker was never closed
