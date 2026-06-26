@favorite-page
Feature: Favorite a page from the document header
  A user can mark the currently open page as a favorite using the star button
  in the top-right header. Favoriting surfaces the page in the sidebar
  "Favorites" section, and the header star reflects the favorite state.
  Toggling it off removes the page from the section again.

  Scenario: Favoriting a renamed page lists it in Favorites and toggles the header star
    Given I am signed in with a new account
    And I have created and opened a document page named "My Favorite Doc"
    Then the header favorite button is not active
    And the Favorites section does not list the page
    When I click the header favorite button
    Then the header favorite button is active
    And the Favorites section lists the page named "My Favorite Doc"
    When I click the header favorite button
    Then the header favorite button is not active
    And the Favorites section does not list the page
