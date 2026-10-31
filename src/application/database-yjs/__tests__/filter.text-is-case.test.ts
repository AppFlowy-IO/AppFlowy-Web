import { textFilterCheck } from '@/application/database-yjs/filter';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';

// WP13 decision 12: web `TextIs` / `TextIsNot` follow the desktop evaluator
// (`cell_filter.rs` lowercases both sides), so a text drill-down lists the
// same rows on both clients.
describe('text filter case (WP13 decision 12)', () => {
  it('TextIs ignores case on both sides', () => {
    expect(textFilterCheck('Login fails', 'login FAILS', TextFilterCondition.TextIs)).toBe(true);
    expect(textFilterCheck('ÉCOLE', 'école', TextFilterCondition.TextIs)).toBe(true);
    expect(textFilterCheck('Login fails', 'Login fail', TextFilterCondition.TextIs)).toBe(false);
    expect(textFilterCheck('', 'a', TextFilterCondition.TextIs)).toBe(false);
  });

  it('TextIsNot ignores case on both sides', () => {
    expect(textFilterCheck('Login fails', 'LOGIN FAILS', TextFilterCondition.TextIsNot)).toBe(false);
    expect(textFilterCheck('Login fails', 'Crash', TextFilterCondition.TextIsNot)).toBe(true);
  });

  it('TextContains is unchanged (it already ignored case)', () => {
    expect(textFilterCheck('Token refresh race', 'TOKEN', TextFilterCondition.TextContains)).toBe(true);
    expect(textFilterCheck('Token refresh race', 'crash', TextFilterCondition.TextContains)).toBe(false);
  });
});
