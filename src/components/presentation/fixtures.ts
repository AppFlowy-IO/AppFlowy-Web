import { parseMarkdown } from './source';

export const SAMPLE_MARKDOWN = `## A more connected workspace
Our Q3 focus is simple: help teams move from scattered information to shared understanding.
Bring project knowledge, decisions, and everyday work into one place.

## What we delivered
- Launched the redesigned workspace home
  - A single starting point for recent work and shared pages
  - Faster access to team spaces
- Shipped database timeline views
- Improved document collaboration

## Progress at a glance
- 3 major product milestones delivered
- 24 customer interviews completed
- 8 teams participating in the design partner program

## What we learned
Teams need context alongside their tasks, not another place to maintain it.
> “I want to understand why a decision was made without searching through five different tools.” — Design partner interview
- Keep the path from information to action short
- Make ownership and next steps visible

## Next quarter
- October: validate presentation workflows with design partners
- November: build the first end-to-end experience
- December: review feedback and prepare a wider rollout

## Decisions & next steps
- Confirm the presentation MVP scope
- Assign an owner for each workstream
- Schedule a design partner review
`;
export const SAMPLE_SNAPSHOT = parseMarkdown(SAMPLE_MARKDOWN, 'Q3 Product Review');
export const ROW_SNAPSHOT = {
  ...SAMPLE_SNAPSHOT,
  pageId: 'sample-row',
  kind: 'row' as const,
  title: 'Presentation MVP',
  properties: [
    { id: 'prop-status', name: 'Status', type: 'single-select', value: 'In progress' },
    { id: 'prop-owner', name: 'Owner', type: 'person', value: 'Design team' },
    { id: 'prop-date', name: 'Target date', type: 'date', value: '2026-12-15' },
    { id: 'prop-budget', name: 'Budget', type: 'number', value: null },
  ],
};
