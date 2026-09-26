# Published workflows as concrete regression cases

The inputs are independently authored, reproducible test records based on published workflows. They are not customer data or a copy of a production database. Both clients use identical `researched_scenarios.json` / `researched-scenarios.json` fixtures, a fixed UTC clock, and explicit input products.

| Workflow and primary source | Concrete example and expected result | Exhaustive finite product |
| --- | --- | ---: |
| [Notion: project deadlines](https://www.notion.com/help/formulas) | Start 2026-09-01 → due 2026-09-15; on 2026-09-25 it is Overdue unless Done. Missing start is Unscheduled; due today is On track. | 4 starts × 4 statuses = **16** |
| [Notion: RICE prioritization and person vote counts](https://www.notion.com/help/formulas) | Reach 100 × impact 2 × confidence 0.8 ÷ effort 4 = **40**. Two voters count as 2. Missing or zero effort is guarded. | 4 reach × 4 impact × 4 confidence × 4 effort × 3 voter lists = **768** |
| [Airtable: order totals](https://support.airtable.com/articles/8772429326-getting-started-with-the-airtable-formula-field) | Price 19.99 × quantity 3, discount 10%, tax 20% = **64.77**. Paid orders have zero outstanding; cancelled orders have zero total. | 4 prices × 4 quantities × 2 discounts × 2 tax rates × 2 cancellation states × 2 payment states = **256** |
| [Airtable: campaign averages using Rollup](https://support.airtable.com/articles/7497685062-rollup-field-overview) | Formula open rates are **20%, 40%, 0%, Empty**. All four average to **20%**; the first two average to **30%**. Zero counts in the denominator; Empty does not. | All subsets of 4 related campaigns = **16** |

Total: **1,056 business input combinations per platform**. Missing-input guards, invoice discount/tax/payment logic, negative-price examples, and fixed fixture values are AppFlowy test adaptations, not claims that the linked guides specify those exact policies. Expected invoice totals use independent decimal arithmetic; expected dates use calendar arithmetic; expected campaign averages use the authored rates, never Formula outputs as their oracle.

## Production paths

- Desktop scalar workflows encode stored database cells and run `FormulaFields`, including Formula references. The campaign test creates actual SDK databases, writes source rows, computes rate Formula targets, changes relations for every subset, checks Average plus a downstream Formula, and verifies the final result after closing/reopening the database views in the same SDK.
- Web scalar workflows encode Yjs cells and run `evaluateFormulaCell`. Campaign subsets run the production Formula and Rollup evaluators on related database YDocs, then verify independently serialized/reloaded graphs and a downstream Formula.

The separate concrete-value fixture expands coverage to 26 result contracts / 187 value states across all 20 field types, with all realizable ordered pairs and triples, typed conditions and operators. It distinguishes missing, blank, zero, false, malformed numeric input, fractions, Unicode, list order, date ranges, and empty relations. A Rollup Sum containing only empty Formula results remains Empty in AppFlowy; a numeric zero remains numeric zero. These tests assert AppFlowy's explicit contract rather than assuming every behavior matches another product.

## Scope

These are unit and database integration cases, not millions of UI interactions. Every listed scenario dimension participates in its complete Cartesian product. Arbitrary strings, real numbers, Formula programs, list lengths and dependency graphs are unbounded; no finite suite can enumerate all possible values or programs. The documented dataset, expression templates and case-count guards make the tested boundary reviewable.
