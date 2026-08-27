@relation-two-way
Feature: Two-way relation matches desktop
  Desktop's `ensure_relation_two_way_reciprocal_field` (rust-lib/flowy-database2,
  event_handler.rs) creates a reciprocal Relation field in the related database,
  points it back at the source database and field, appends it to the related
  view, and backfills the links that already existed. Disabling two-way deletes
  that field again and clears the source's reciprocal_field_id.

  Background:
    Given the two-way relation user is signed in

  Scenario: Enabling two-way adds the reciprocal property to the related database
    Given a two-way grid "Orders" with rows "Ord-1, Ord-2"
    And a two-way grid "Customers" with rows "Ada, Grace"
    And a one-way relation property "Orders" on "Customers" pointing at "Orders"
    When the two-way relation toggle is turned on for "Orders"
    Then the source relation records a reciprocal field id
    And the related database "Orders" lists the reciprocal property in its view
    And the reciprocal property is named "Orders"
    And the reciprocal property points back at the "Customers" database
    And the reciprocal property points back at the source relation field
    And the reciprocal property is two-way with no source or target limit

  Scenario: Enabling two-way backfills the links that already existed
    Given a two-way grid "Backfill Orders" with rows "Ord-1, Ord-2"
    And a two-way grid "Backfill Customers" with rows "Ada, Grace"
    And a one-way relation property "Orders" on "Backfill Customers" pointing at "Backfill Orders"
    And row 0 of "Backfill Customers" links "Ord-1, Ord-2"
    And row 1 of "Backfill Customers" links "Ord-1"
    When the two-way relation toggle is turned on for "Orders"
    Then related row 0 of "Backfill Orders" links back to source rows 0 and 1
    And related row 1 of "Backfill Orders" links back to source row 0

  Scenario: Disabling two-way deletes the reciprocal property again
    Given a two-way grid "Teardown Orders" with rows "Ord-1"
    And a two-way grid "Teardown Customers" with rows "Ada"
    And a one-way relation property "Orders" on "Teardown Customers" pointing at "Teardown Orders"
    And the two-way relation toggle has already been turned on for "Orders"
    And the reciprocal property has reached the related database "Teardown Orders"
    When the two-way relation toggle is turned off for "Orders"
    Then the source relation no longer records a reciprocal field id
    And the related database "Teardown Orders" no longer has the reciprocal property
