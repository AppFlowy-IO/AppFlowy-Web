import type { StoryPlan } from './types';

/** Compare only fields the story editor exposes, including slide order and removals. */
function editablePlan(plan: StoryPlan) {
  return {
    title: plan.title,
    slides: plan.slides.map(({ id, layout, title, message, points }) => ({ id, layout, title, message, points })),
  };
}

export function hasStoryPlanChanges(plan: StoryPlan, baseline: StoryPlan) {
  return JSON.stringify(editablePlan(plan)) !== JSON.stringify(editablePlan(baseline));
}

/** Old template geometry or exhibits must not override a newly selected layout. */
export function prepareStoryPlan(plan: StoryPlan, baseline: StoryPlan): StoryPlan {
  const previous = new Map(baseline.slides.map((slide) => [slide.id, slide]));

  return {
    ...plan,
    slides: plan.slides.map((slide) => {
      if (previous.get(slide.id)?.layout === slide.layout) return { ...slide };
      const { templateSlideId: _template, templateContent: _content, table: _table, chart: _chart, ...rest } = slide;

      return rest;
    }),
  };
}
