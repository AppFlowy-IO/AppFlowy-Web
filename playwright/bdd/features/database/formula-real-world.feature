@formula @formula-real-world
Feature: Formulas people write in Notion
  Formulas taken from Notion's help center and well-known Notion formula
  guides work the same way in AppFlowy: prioritising tasks, counting down to
  due dates, building links, tracking progress and money. Sources: notion.com
  help (formula syntax, formulas, writing formulas, new formulas), Thomas
  Frank's formula reference, notion.vip, Zapier, notionthings.com, Red
  Gregory, noteapiconnector.com.

  Background:
    Given a Grid for formula testing with these properties
      | property    | type        | row 1                                         | row 2                                  | row 3          |
      | Name        | Text        | Website Redesign                              | Tax filing                             | Team offsite   |
      | Important   | Checkbox    | yes                                           | yes                                    | no             |
      | Urgent      | Checkbox    | no                                            | yes                                    | yes            |
      | Due         | Date        | today+5                                       | today-1                                | today+10       |
      | Status      | Select      | In Progress                                   | Not started                            | Done           |
      | Tags        | MultiSelect | Finance, Design, Urgent                       | Finance                                | <empty>        |
      | Website     | URL         | https://appflowy.io/pricing                   | https://www.appflowy.io/blog/x?ref=nav | <empty>        |
      | UTM Source  | Text        | newsletter                                    | <empty>                                | newsletter     |
      | Notes       | Text        | Ship the new landing page                     | <empty>                                | Book the venue |
      | Net         | Number      | 1200                                          | 1234567                                | <empty>        |
      | Tax Rate    | Number      | 0.08                                          | 0.1                                    | <empty>        |
      | Steps       | Checklist   | 3/4                                           | 0/2                                    | 2/2            |
      | Time Spent  | Time        | 9000000                                       | 5580000                                | <empty>        |
      | Attachments | Files       | brief.pdf, hero.png, theme.MP3                | <empty>                                | agenda.pdf     |
      | Summary     | AISummary   | Redesign the marketing site. Launch in March. | <empty>                                | <empty>        |

  Scenario: Task management formulas
    When I add these formula properties
      | name       | expression                                                                                                                                              |
      | Eisenhower | if(prop("Important"), if(prop("Urgent"), "Do", "Schedule"), if(prop("Urgent"), "Delegate", "Eliminate"))                                               |
      | Countdown  | if(dateBetween(prop("Due"), today(), "days") < 0, "Overdue", dateBetween(prop("Due"), today(), "days") + " days left")                                   |
      | Overdue    | if(and(today() > prop("Due"), prop("Status") != "Done"), "Overdue", "")                                                                                 |
      | Urgency    | ifs(dateBetween(prop("Due"), today(), "days") <= 3, "🔴 Urgent", dateBetween(prop("Due"), today(), "days") <= 7, "🟡 Soon", "🟢 On track")              |
      | Readiness  | if(prop("Status") == "Done", "✅ Done", if(empty(prop("Attachments")) or empty(prop("Due")), "❌ Incomplete", "🟡 Ready"))                               |
      | Score      | (prop("Important").toNumber() + prop("Urgent").toNumber()) / 2                                                                                           |
    Then the formula "Eisenhower" shows these values
      | Schedule |
      | Do       |
      | Delegate |
    And the formula "Countdown" shows these values
      | 5 days left  |
      | Overdue      |
      | 10 days left |
    And the formula "Overdue" shows these values
      |         |
      | Overdue |
      |         |
    And the formula "Urgency" shows these values
      | 🟡 Soon     |
      | 🔴 Urgent   |
      | 🟢 On track |
    And the formula "Readiness" shows these values
      | 🟡 Ready      |
      | ❌ Incomplete |
      | ✅ Done       |
    And the formula "Score" shows these values
      | 0.5 |
      | 1   |
      | 0.5 |
    When I click row 1 of "Urgent"
    Then the formula "Eisenhower" shows these values
      | Do       |
      | Do       |
      | Delegate |
    And the formula "Score" shows these values
      | 1   |
      | 1   |
      | 0.5 |
    When I click row 3 of "Urgent"
    Then the formula "Eisenhower" shows these values
      | Do        |
      | Do        |
      | Eliminate |

  Scenario: Prioritised tasks filter and sort by their formulas
    Given a formula property "Eisenhower" with the expression "if(prop("Important"), if(prop("Urgent"), "Do", "Schedule"), if(prop("Urgent"), "Delegate", "Eliminate"))"
    And a formula property "Days left" with the expression "dateBetween(prop("Due"), today(), "days")"
    Then filtering "Eisenhower" by these text conditions shows these rows
      | condition   | value | rows                     |
      | is          | Do    | Tax filing               |
      | is not      | Do    | Website Redesign, Team offsite |
      | starts with | de    | Team offsite             |
    And filtering "Days left" by these number conditions shows these rows
      | condition    | value | rows                           |
      | less than    | 0     | Tax filing                     |
      | greater than | 3     | Website Redesign, Team offsite |
    When I sort "Days left" ascending
    Then the grid shows these rows
      | Tax filing       |
      | Website Redesign |
      | Team offsite     |

  Scenario: Link and text formulas
    When I add these formula properties
      | name       | expression                                                                                                                              |
      | UTM link   | ifs(empty(prop("Website")), "", empty(prop("UTM Source")), "Add a source", prop("Website") + "?utm_source=" + prop("UTM Source"))       |
      | Domain     | replaceAll(replaceAll(replaceAll(prop("Website"), ".*www.", ""), ".*https://", ""), "[/].*", "")                                        |
      | Word Count | if(length(prop("Notes")) > 0, length(replaceAll(prop("Notes"), "[^ ]", "")) + 1, 0)                                                     |
      | Length     | if(prop("Word Count") > 3, "Long", "Short")                                                                                             |
      | Sentence   | prop("Name") + " has " + prop("Tags").length() + " tags."                                                                               |
      | Finance    | prop("Tags").includes("Finance")                                                                                                        |
    Then the formula "UTM link" shows these values
      | https://appflowy.io/pricing?utm_source=newsletter |
      | Add a source                                      |
      |                                                   |
    And the formula "Domain" shows these values
      | appflowy.io |
      | appflowy.io |
      |             |
    And the formula "Word Count" shows these values
      | 5 |
      | 0 |
      | 3 |
    And the formula "Length" shows these values
      | Long  |
      | Short |
      | Short |
    And the formula "Sentence" shows these values
      | Website Redesign has 3 tags. |
      | Tax filing has 1 tags.       |
      | Team offsite has 0 tags.     |
    And the formula "Finance" shows these values
      | Yes |
      | Yes |
      | No  |
    When I type "blog" into row 2 of "UTM Source"
    Then the formula "UTM link" shows these values
      | https://appflowy.io/pricing?utm_source=newsletter        |
      | https://www.appflowy.io/blog/x?ref=nav?utm_source=blog   |
      |                                                          |
    When I type "Book the venue and the flights" into row 3 of "Notes"
    Then the formula "Length" shows these values
      | Long  |
      | Short |
      | Long  |

  Scenario: Progress and money formulas
    When I add these formula properties
      | name       | expression                                                                                                                                                                                              |
      | Progress   | substring("▒▒▒▒▒▒▒▒▒▒", 0, round(prop("Steps") / 10)) + " " + prop("Steps") + "%"                                                                                                                      |
      | Checklist  | ifs(prop("Steps") == 100, "✅ All tasks complete", prop("Steps") > 0, "⚠️ In progress", "❌ Not started")                                                                                               |
      | Hours      | format(floor(prop("Time Spent") / 3600000)) + "h:" + format(floor(prop("Time Spent") / 60000) % 60) + "m"                                                                                               |
      | Total      | if(empty(prop("Net")), "", formatNumber(let(tax, prop("Net") * prop("Tax Rate"), prop("Net") + tax), "usd", 2))                                                                                        |
      | File kinds | prop("Attachments").map(if(test(current, "([jJ][pP][eE]?[gG]\|[gG][iI][fF]\|[pP][nN][gG])"), "🌅 Image", if(test(current, "([mM][pP]3\|[wW][aA][vV])"), "🎧 Audio", "📝 Text"))).join(", ")             |
      | AI status  | if(empty(prop("Summary")), "❌ Missing", "✅ " + prop("Summary").split(". ").length() + " sentences")                                                                                                   |
    Then the formula "Progress" shows these values
      | ▒▒▒▒▒▒▒▒ 75%     |
      | 0%               |
      | ▒▒▒▒▒▒▒▒▒▒ 100%  |
    And the formula "Checklist" shows these values
      | ⚠️ In progress        |
      | ❌ Not started        |
      | ✅ All tasks complete |
    And the formula "Hours" shows these values
      | 2h:30m |
      | 1h:33m |
      | 0h:0m  |
    And the formula "Total" shows these values
      | $1,296.00        |
      | $1,358,023.70    |
      |                  |
    And the formula "File kinds" shows these values
      | 📝 Text, 🌅 Image, 🎧 Audio |
      |                             |
      | 📝 Text                     |
    And the formula "AI status" shows these values
      | ✅ 2 sentences |
      | ❌ Missing     |
      | ❌ Missing     |
    When I type "45m" into row 3 of "Time Spent"
    Then the formula "Hours" shows these values
      | 2h:30m |
      | 1h:33m |
      | 0h:45m |
    When I type "3000" into row 3 of "Net"
    Then the formula "Total" shows these values
      | $1,296.00     |
      | $1,358,023.70 |
      | $3,000.00     |
