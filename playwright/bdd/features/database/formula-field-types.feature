@formula @formula-field-types
Feature: Formulas read every property type
  A formula can reference a property of any type. Each type reads as the value
  its cell shows: text, a number, a date, a checkbox, or a list of names, and
  an empty cell reads as empty. Related rows read as their titles, rollups as
  their result, and people as their names. The editor knows each property's
  type, and formulas follow input changes of every type.

  Background:
    Given a Grid for formula testing with these properties
      | property    | type        | row 1                          | row 2     |
      | Name        | Text        | Launch plan                    | Blank row |
      | Price       | Number      | 1250.5                         | <empty>   |
      | Due         | Date        | 2024-03-10 -> 2024-03-17       | <empty>   |
      | Status      | Select      | Done                           | <empty>   |
      | Tags        | MultiSelect | Urgent, Work                   | <empty>   |
      | Done        | Checkbox    | yes                            | <empty>   |
      | Link        | URL         | https://docs.appflowy.io/guide | <empty>   |
      | Steps       | Checklist   | 3/4                            | <empty>   |
      | Duration    | Time        | 5400000                        | <empty>   |
      | Files       | Files       | spec.pdf, mock.png             | <empty>   |
      | Summary     | AISummary   | Ship the beta in March.        | <empty>   |
      | Translation | AITranslate | Lancer la bêta en mars.        | <empty>   |

  Scenario: Each stored property type reads as its value
    When I add these formula properties
      | name        | expression                                                     |
      | ƒ text      | upper(prop("Name"))                                            |
      | ƒ number    | prop("Price") * 2                                              |
      | ƒ date      | dateBetween(dateEnd(prop("Due")), dateStart(prop("Due")), "days") |
      | ƒ select    | prop("Status") == "Done"                                       |
      | ƒ multi     | prop("Tags").length() + " tags: " + prop("Tags").join("/")     |
      | ƒ checkbox  | if(prop("Done"), "checked", "unchecked")                       |
      | ƒ url       | split(prop("Link"), "/").at(2)                                 |
      | ƒ checklist | prop("Steps") + "%"                                            |
      | ƒ time      | prop("Duration") / 60000                                       |
      | ƒ files     | prop("Files").length() + " files: " + prop("Files").join(", ") |
      | ƒ summary   | prop("Summary").length()                                       |
      | ƒ translate | contains(prop("Translation"), "bêta")                          |
    Then the formula properties show these values for row 1
      | name        | value                          |
      | ƒ text      | LAUNCH PLAN                    |
      | ƒ number    | 2501                           |
      | ƒ date      | 7                              |
      | ƒ select    | Yes                            |
      | ƒ multi     | 2 tags: Urgent/Work            |
      | ƒ checkbox  | checked                        |
      | ƒ url       | docs.appflowy.io               |
      | ƒ checklist | 75%                            |
      | ƒ time      | 90                             |
      | ƒ files     | 2 files: spec.pdf, mock.png    |
      | ƒ summary   | 23                             |
      | ƒ translate | Yes                            |
    And the formula properties show these values for row 2
      | name        | value     |
      | ƒ text      | BLANK ROW |
      | ƒ number    | 0         |
      | ƒ date      |           |
      | ƒ select    | No        |
      | ƒ multi     | 0 tags:   |
      | ƒ checkbox  | unchecked |
      | ƒ url       |           |
      | ƒ checklist | %         |
      | ƒ time      | 0         |
      | ƒ files     | 0 files:  |
      | ƒ summary   | 0         |
      | ƒ translate | No        |

  Scenario: The editor knows the formula type of every property
    Given a relation property "Linked" to this database
    And a count rollup "Linked count" over "Linked"
    When I add a "Person" property named "Owner"
    And I add a "CreatedTime" property named "Created"
    And I add a "EditedTime" property named "Edited"
    And I add a "CreatedBy" property named "Author"
    And I add a "EditedBy" property named "Editor"
    And I start a new formula property
    Then these formulas infer these types
      | expression            | type       |
      | prop("Name")          | text       |
      | prop("Price")         | number     |
      | prop("Due")           | date       |
      | prop("Status")        | text       |
      | prop("Tags")          | list<text> |
      | prop("Done")          | boolean    |
      | prop("Link")          | text       |
      | prop("Steps")         | number     |
      | prop("Duration")      | number     |
      | prop("Files")         | list<text> |
      | prop("Summary")       | text       |
      | prop("Translation")   | text       |
      | prop("Linked")        | list<text> |
      | prop("Linked count")  | number     |
      | prop("Owner")         | list<text> |
      | prop("Created")       | date       |
      | prop("Edited")        | date       |
      | prop("Author")        | list<text> |
      | prop("Editor")        | list<text> |
    When I hover the catalogue property "Duration"
    Then the docs panel reads "Property of type number."
    And the docs panel shows the example "round(prop("Duration") / 60000)" with result "the time in minutes"
    When I hover the catalogue property "Files"
    Then the docs panel reads "Property of type list<text>."
    And the docs panel shows the example "prop("Files").length()" with result "number of items"
    When I hover the catalogue property "Linked count"
    Then the docs panel reads "Property of type number."
    When I hover the catalogue property "Steps"
    Then the docs panel reads "Property of type number."
    And the docs panel shows the example "prop("Steps") == 100" with result "true when every item is done"

  Scenario: Related rows read as their titles and rollups as their result
    Given a relation property "Linked" to this database
    And a count rollup "Linked count" over "Linked"
    And row 1 of "Linked" links rows 2
    When I add these formula properties
      | name      | expression                                                   |
      | ƒ titles  | prop("Linked").join(" + ")                                   |
      | ƒ count   | prop("Linked").length()                                      |
      | ƒ has     | prop("Linked").includes("Blank row")                         |
      | ƒ rollup  | prop("Linked count") * 10                                    |
      | ƒ chained | if(prop("ƒ rollup") > 0, "linked to " + prop("ƒ titles"), "") |
    Then the formula properties show these values for row 1
      | name      | value               |
      | ƒ titles  | Blank row           |
      | ƒ count   | 1                   |
      | ƒ has     | Yes                 |
      | ƒ rollup  | 10                  |
      | ƒ chained | linked to Blank row |
    And the formula properties show these values for row 2
      | name      | value |
      | ƒ titles  |       |
      | ƒ count   | 0     |
      | ƒ has     | No    |
      | ƒ rollup  | 0     |
      | ƒ chained |       |
    When I type "Draft notes" into row 2 of "Name"
    Then the formula properties show these values for row 1
      | name      | value                 |
      | ƒ titles  | Draft notes           |
      | ƒ has     | No                    |
      | ƒ chained | linked to Draft notes |
    When row 1 of "Linked" links rows 1, 2
    Then the formula properties show these values for row 1
      | name     | value                     |
      | ƒ titles | Launch plan + Draft notes |
      | ƒ count  | 2                         |
      | ƒ rollup | 20                        |
    When row 1 of "Linked" links no rows
    Then the formula properties show these values for row 1
      | name      | value |
      | ƒ titles  |       |
      | ƒ count   | 0     |
      | ƒ rollup  | 0     |
      | ƒ chained |       |
    When I reload the grid
    Then the formula properties show these values for row 1
      | name     | value |
      | ƒ count  | 0     |
      | ƒ rollup | 0     |

  Scenario: The editor preview and a conversion keep related titles and member names
    Given a relation property "Linked" to this database
    And row 1 of "Linked" links rows 2
    When I add a "CreatedBy" property named "Author"
    And I add these formula properties
      | name     | expression                 |
      | ƒ titles | prop("Linked").join(" + ") |
      | ƒ author | prop("Author").first()     |
    Then the formula properties show these values for row 1
      | name     | value     |
      | ƒ titles | Blank row |
    When I open the formula editor of "ƒ titles" by clicking its cell in row 1
    Then the formula preview shows "Blank row"
    When I close the formula editor with "the Cancel button"
    And I open the formula editor of "ƒ author" by clicking its cell in row 1
    Then the formula preview shows the member names of "Author" in row 1
    When I close the formula editor with "the Cancel button"
    And I switch the property "ƒ titles" to "Text"
    And I switch the property "ƒ author" to "Text"
    Then the "ƒ titles" cells read in order
      | Blank row |
      |           |
    And row 1 of "ƒ author" reads the member names of "Author"

  Scenario: People read as member names
    When I add a "Person" property named "Owner"
    And I add a "CreatedBy" property named "Author"
    And I add a "EditedBy" property named "Editor"
    And I add these formula properties
      | name      | expression                                                  |
      | ƒ owner   | prop("Owner").join(", ")                                    |
      | ƒ owners  | if(empty(prop("Owner")), "Unassigned", prop("Owner").length() + " owner") |
      | ƒ author  | prop("Author").first()                                      |
      | ƒ editor  | prop("Editor").first()                                      |
      | ƒ self    | prop("Author") == prop("Editor")                            |
    Then the formula properties show these values for row 1
      | name     | value      |
      | ƒ owner  |            |
      | ƒ owners | Unassigned |
      | ƒ self   | Yes        |
    And row 1 of "ƒ author" shows the member names of "Author"
    And row 2 of "ƒ editor" shows the member names of "Editor"
    When I assign myself in row 1 of "Owner"
    Then row 1 of "ƒ owner" shows the member names of "Owner"
    And the formula properties show these values for row 1
      | name     | value   |
      | ƒ owners | 1 owner |
    And the formula properties show these values for row 2
      | name     | value      |
      | ƒ owners | Unassigned |
    When I reload the grid
    Then row 1 of "ƒ owner" shows the member names of "Owner"
    And row 1 of "ƒ author" shows the member names of "Author"

  Scenario: Row timestamps read as dates
    When I add a "CreatedTime" property named "Created"
    And I add a "EditedTime" property named "Edited"
    And I add these formula properties
      | name         | expression                                                              |
      | ƒ age        | dateBetween(now(), prop("Created"), "days")                             |
      | ƒ this year  | formatDate(prop("Created"), "YYYY") == formatDate(now(), "YYYY")        |
      | ƒ edited     | dateBetween(prop("Edited"), prop("Created"), "minutes") >= 0            |
      | ƒ today      | formatDate(prop("Edited"), "YYYY-MM-DD") == formatDate(today(), "YYYY-MM-DD") |
    Then the formula properties show these values for row 1
      | name        | value |
      | ƒ age       | 0     |
      | ƒ this year | Yes   |
      | ƒ edited    | Yes   |
      | ƒ today     | Yes   |

  Scenario: Formulas follow edits to inputs of every type
    Given a formula property "ƒ minutes" with the expression "prop("Duration") / 60000"
    And a formula property "ƒ files" with the expression "prop("Files").length()"
    And a formula property "ƒ summary" with the expression "if(empty(prop("Summary")), "❌ Missing", "✅ " + prop("Summary"))"
    And a formula property "ƒ link" with the expression "replace(prop("Link"), "https://", "")"
    When I type "2h15m" into row 2 of "Duration"
    Then the formula "ƒ minutes" shows these values
      | 90  |
      | 135 |
    When I type "08:30" into row 1 of "Duration"
    Then the formula "ƒ minutes" shows these values
      | 510 |
      | 135 |
    When I type "appflowy.io" into row 2 of "Link"
    Then the formula "ƒ link" shows these values
      | docs.appflowy.io/guide |
      | appflowy.io            |
    When a collaborator sets row 2 of "Summary" to "Plan the release."
    Then the formula "ƒ summary" shows these values
      | ✅ Ship the beta in March. |
      | ✅ Plan the release.       |
    And the formula "ƒ files" shows these values
      | 2 |
      | 0 |

  Scenario: Filters and sorts use related titles
    Given a relation property "Linked" to this database
    And row 1 of "Linked" links rows 2
    And row 2 of "Linked" links rows 1
    And a formula property "ƒ linked" with the expression "prop("Linked").first()"
    Then filtering "ƒ linked" by these text conditions shows these rows
      | condition | value  | rows        |
      | contains  | launch | Blank row   |
      | is        | Blank row | Launch plan |
    When I sort "ƒ linked" ascending
    Then the grid shows these rows
      | Launch plan |
      | Blank row   |
    When I type "Aardvark" into row 1 of "Name"
    Then the grid shows these rows
      | Blank row |
      | Aardvark  |
    And the "ƒ linked" cells read in order
      | Aardvark  |
      | Blank row |
