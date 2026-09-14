@formula @formula-language
Feature: Formula language matches Notion
  Formulas use Notion's language: typed values, prop() references, operators
  with Notion precedence, let/lets variables, dot notation, comments, and the
  logic, text, number, date and list functions. Every scenario types formulas
  through the editor and reads the evaluated cells.

  Scenario: Operators follow Notion precedence and typing rules
    Given a Grid for formula testing with these properties
      | property | type   | row 1 |
      | A        | Number | 8     |
      | B        | Number | 3     |
      | Name     | Text   | Ada   |
    When I add these formula properties
      | name    | expression                                  |
      | arith   | prop("A") + prop("B") * 2 - 1               |
      | power   | 2 ^ 3 ^ 2                                   |
      | modulo  | prop("A") % prop("B")                       |
      | divide  | prop("A") / 4                               |
      | concat  | prop("Name") + " " + "Lovelace"             |
      | compare | prop("A") > prop("B") and not (prop("B") == 3) |
      | orOp    | false or prop("A") >= 8                     |
      | ternary | prop("A") > 5 ? "big" : "small"             |
      | nested  | prop("A") > 9 ? "big" : prop("A") > 5 ? "mid" : "small" |
    Then the formula properties show these values for row 1
      | name    | value        |
      | arith   | 13           |
      | power   | 512          |
      | modulo  | 2            |
      | divide  | 2            |
      | concat  | Ada Lovelace |
      | compare | No           |
      | orOp    | Yes          |
      | ternary | big          |
      | nested  | mid          |

  Scenario: let, lets, current and index bind variables
    Given a Grid for formula testing with these properties
      | property | type        | row 1     |
      | Price    | Number      | 100       |
      | Tags     | MultiSelect | a, b, c   |
    When I add these formula properties
      | name     | expression                                                     |
      | withTax  | let(tax, prop("Price") * 0.1, prop("Price") + tax)             |
      | lets     | lets(a, 1, b, a + 1, a + b)                                    |
      | mapped   | prop("Tags").map(format(index) + ":" + current).join(" ")      |
      | shadow   | let(x, 2, let(x, 3, x))                                        |
    Then the formula properties show these values for row 1
      | name    | value         |
      | withTax | 110           |
      | lets    | 3             |
      | mapped  | 0:a 1:b 2:c   |
      | shadow  | 3             |

  Scenario: Multi-line formulas, comments and dot notation
    Given a Grid for formula testing with these properties
      | property | type   | row 1 |
      | Name     | Text   | hello |
    When I start a new formula property
    And I type the formula:
      """
      /* uppercase and measure */
      prop("Name").upper()
        .substring(0, 3)
        .length()
      """
    Then the formula editor infers type "number"
    And the formula preview shows "3"
    When I save the formula
    Then the last formula column shows these values
      | 3 |

  Scenario: Empty values follow Notion semantics
    Given a Grid for formula testing with these properties
      | property | type   | row 1   |
      | Price    | Number | <empty> |
      | Name     | Text   | <empty> |
      | Due      | Date   | <empty> |
    When I add these formula properties
      | name       | expression                                                  |
      | plusOne    | prop("Price") + 1                                           |
      | isEmpty    | empty(prop("Price")) and empty(prop("Name")) and empty(prop("Due")) |
      | zeroEmpty  | empty(0) and empty("") and empty([]) and not empty("x")     |
      | dateGuard  | if(empty(prop("Due")), "no date", formatDate(prop("Due"), "YYYY")) |
      | emptyDate  | dateAdd(prop("Due"), 1, "days")                             |
    Then the formula properties show these values for row 1
      | name      | value   |
      | plusOne   | 1       |
      | isEmpty   | Yes     |
      | zeroEmpty | Yes     |
      | dateGuard | no date |
      | emptyDate |         |

  Scenario: Logic functions
    Given a Grid for formula testing with these properties
      | property | type     | row 1 | row 2 |
      | Done     | Checkbox | yes   | no    |
      | Score    | Number   | 90    | 40    |
    When I add these formula properties
      | name    | expression                                                        |
      | status  | if(prop("Done"), "Complete", "Open")                              |
      | grade   | ifs(prop("Score") >= 90, "A", prop("Score") >= 50, "B", "C")      |
      | both    | and(prop("Done"), prop("Score") > 50)                             |
      | either  | or(prop("Done"), prop("Score") > 50)                              |
      | inverse | not(prop("Done"))                                                 |
      | eq      | equal(prop("Score"), 90) or unequal(prop("Score"), 40)            |
    Then the formula properties show these values for row 1
      | name    | value    |
      | status  | Complete |
      | grade   | A        |
      | both    | Yes      |
      | either  | Yes      |
      | inverse | No       |
      | eq      | Yes      |
    And the formula properties show these values for row 2
      | name    | value |
      | status  | Open  |
      | grade   | C     |
      | both    | No    |
      | either  | No    |
      | inverse | Yes   |
      | eq      | No    |

  Scenario: Text functions
    Given a Grid for formula testing with these properties
      | property | type | row 1          |
      | Name     | Text |   Ada Lovelace |
      | Code     | Text | AB-12-CD       |
    When I add these formula properties
      | name       | expression                                       |
      | length     | length(trim(prop("Name")))                       |
      | sub        | substring(trim(prop("Name")), 0, 3)              |
      | contains   | contains(prop("Name"), "Love")                   |
      | test       | test(prop("Code"), "\\\\d+")                     |
      | match      | match(prop("Code"), "[A-Z]+").join("+")          |
      | replace    | replace(prop("Code"), "-", "/")                  |
      | replaceAll | replaceAll(prop("Code"), "-", "")                |
      | lower      | lower(prop("Code"))                              |
      | upper      | upper(trim(prop("Name")))                        |
      | repeat     | repeat("ab", 3)                                  |
      | split      | split(prop("Code"), "-").length()                |
      | format     | format(12) + "\|" + format(true)                 |
      | toNumber   | toNumber("1,234.5") + toNumber(prop("Code").split("-").at(1)) |
    Then the formula properties show these values for row 1
      | name       | value        |
      | length     | 12           |
      | sub        | Ada          |
      | contains   | Yes          |
      | test       | Yes          |
      | match      | AB+CD        |
      | replace    | AB/12-CD     |
      | replaceAll | AB12CD       |
      | lower      | ab-12-cd     |
      | upper      | ADA LOVELACE |
      | repeat     | ababab       |
      | split      | 3            |
      | format     | 12\|true     |
      | toNumber   | 1246.5       |

  Scenario: Number functions
    Given a Grid for formula testing with these properties
      | property | type   | row 1 |
      | N        | Number | -7.25 |
      | M        | Number | 16    |
    When I add these formula properties
      | name     | expression                                              |
      | ops      | add(1, 2) + subtract(5, 2) + multiply(2, 3) + divide(8, 2) + mod(7, 3) + pow(2, 3) |
      | abs      | abs(prop("N"))                                          |
      | round    | round(prop("N")) + round(prop("N"), 1)                  |
      | ceilFl   | ceil(prop("N")) + floor(prop("N"))                      |
      | roots    | sqrt(prop("M")) + cbrt(27)                              |
      | logs     | log10(1000) + log2(8) + ln(e()) + exp(0)                |
      | sign     | sign(prop("N")) + sign(prop("M"))                       |
      | minmax   | min(prop("N"), prop("M"), 3) + max([1, 9, 4])           |
      | stats    | sum(1, 2, 3) + mean([2, 4]) + median([1, 2, 10])        |
      | pi       | round(pi(), 4)                                          |
      | fmtNum   | formatNumber(1234.5, "commas") + " " + formatNumber(0.25, "percent") + " " + formatNumber(1500, "usd", 2) |
    Then the formula properties show these values for row 1
      | name   | value                      |
      | ops    | 25                         |
      | abs    | 7.25                       |
      | round  | -14.2                      |
      | ceilFl | -15                        |
      | roots  | 7                          |
      | logs   | 8                          |
      | sign   | 0                          |
      | minmax | 1.75                       |
      | stats  | 11                         |
      | pi     | 3.1416                     |
      | fmtNum | 1,234.5 25% $1,500.00      |

  Scenario: Date functions
    Given a Grid for formula testing with these properties
      | property | type | row 1                          |
      | Start    | Date | 2024-03-10                     |
      | End      | Date | 2024-03-24 -> 2024-03-31       |
      | At       | Date | 2024-01-01 09:30               |
    When I add these formula properties
      | name      | expression                                                |
      | parts     | format(year(prop("Start"))) + "-" + format(month(prop("Start"))) + "-" + format(date(prop("Start"))) |
      | weekday   | day(prop("Start"))                                        |
      | week      | week(prop("Start"))                                       |
      | time      | format(hour(prop("At"))) + ":" + format(minute(prop("At"))) |
      | between   | dateBetween(prop("End"), prop("Start"), "days")           |
      | weeks     | dateBetween(prop("End"), prop("Start"), "weeks")          |
      | added     | formatDate(dateAdd(prop("Start"), 2, "weeks"), "YYYY-MM-DD") |
      | subbed    | formatDate(dateSubtract(prop("Start"), 1, "months"), "YYYY-MM-DD") |
      | quarter   | formatDate(dateAdd(prop("Start"), 1, "quarters"), "YYYY-MM-DD") |
      | range     | formatDate(dateStart(prop("End")), "D") + "->" + formatDate(dateEnd(prop("End")), "D") |
      | made      | formatDate(dateRange(prop("Start"), prop("End")), "MMM D") |
      | tokens    | formatDate(prop("Start"), "dddd, MMMM Do YYYY [Week] W")  |
      | stamp     | timestamp(fromTimestamp(86400000)) / 86400000             |
      | parsed    | formatDate(parseDate("2024-12-25"), "MM/DD/YYYY")         |
      | nextDay   | dateAdd(prop("Start"), 1, "days")                         |
      | isPast    | prop("Start") < now()                                     |
    Then the formula properties show these values for row 1
      | name    | value                              |
      | parts   | 2024-3-10                          |
      | weekday | 7                                  |
      | week    | 10                                 |
      | time    | 9:30                               |
      | between | 14                                 |
      | weeks   | 2                                  |
      | added   | 2024-03-24                         |
      | subbed  | 2024-02-10                         |
      | quarter | 2024-06-10                         |
      | range   | 24->31                             |
      | made    | Mar 10                             |
      | tokens  | Sunday, March 10th 2024 Week 10    |
      | stamp   | 1                                  |
      | parsed  | 12/25/2024                         |
      | nextDay | 03/11/2024                         |
      | isPast  | Yes                                |

  Scenario: List functions over a multi-select property
    Given a Grid for formula testing with these properties
      | property | type        | row 1         |
      | Tags     | MultiSelect | beta, alpha, gamma, alpha |
    When I add these formula properties
      | name     | expression                                                   |
      | length   | prop("Tags").length()                                        |
      | at       | prop("Tags").at(1) + "/" + first(prop("Tags")) + "/" + last(prop("Tags")) |
      | slice    | prop("Tags").slice(1, 3).join(",")                            |
      | sorted   | sort(prop("Tags")).join(",")                                  |
      | reversed | reverse(prop("Tags")).join(",")                               |
      | unique   | unique(prop("Tags")).length()                                 |
      | includes | prop("Tags").includes("gamma") and not prop("Tags").includes("delta") |
      | filter   | prop("Tags").filter(current != "alpha").join(",")             |
      | find     | prop("Tags").find(current.length() == 5)                      |
      | findIdx  | prop("Tags").findIndex(current == "gamma")                    |
      | some     | prop("Tags").some(current == "beta") and prop("Tags").every(current.length() > 3) |
      | concat   | concat(prop("Tags"), ["delta"]).length()                      |
      | flat     | flat([[1, 2], [3]]).map(current * 2).sum()                    |
      | nested   | [3, 1, 2].sort().reverse().first()                            |
    Then the formula properties show these values for row 1
      | name     | value                  |
      | length   | 4                      |
      | at       | alpha/beta/alpha       |
      | slice    | alpha,gamma            |
      | sorted   | alpha,alpha,beta,gamma |
      | reversed | alpha,gamma,alpha,beta |
      | unique   | 3                      |
      | includes | Yes                    |
      | filter   | beta,gamma             |
      | find     | alpha                  |
      | findIdx  | 2                      |
      | some     | Yes                    |
      | concat   | 5                      |
      | flat     | 12                     |
      | nested   | 3                      |

  Scenario: Every supported property type can be read
    Given a Grid for formula testing with these properties
      | property | type        | row 1                 |
      | Name     | Text        | Widget                |
      | Price    | Number      | 12.5                  |
      | Done     | Checkbox    | yes                   |
      | Due      | Date        | 2024-03-10            |
      | Priority | Select      | High                  |
      | Tags     | MultiSelect | a, b                  |
      | Link     | URL         | https://appflowy.io   |
      | Steps    | Checklist   | 2/3                   |
      | Created  | CreatedTime | <auto>                |
      | Edited   | EditedTime  | <auto>                |
    When I add these formula properties
      | name     | expression                                                   |
      | text     | prop("Name") + " (" + prop("Priority") + ")"                 |
      | number   | prop("Price") * 2                                            |
      | checkbox | prop("Done")                                                 |
      | date     | formatDate(prop("Due"), "YYYY-MM-DD")                        |
      | list     | prop("Tags").join("+")                                       |
      | url      | contains(prop("Link"), "appflowy")                           |
      | progress | prop("Steps")                                                |
      | created  | year(prop("Created")) == year(now())                         |
      | edited   | dateBetween(now(), prop("Edited"), "days") < 1               |
    Then the formula properties show these values for row 1
      | name     | value          |
      | text     | Widget (High)  |
      | number   | 25             |
      | checkbox | Yes            |
      | date     | 2024-03-10     |
      | list     | a+b            |
      | url      | Yes            |
      | progress | 67             |
      | created  | Yes            |
      | edited   | Yes            |
