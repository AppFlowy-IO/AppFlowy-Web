import {
  globalFilterScreenBackTarget,
  globalFilterSheetBackTarget,
  GlobalFilterMenuScreen,
  initialGlobalFilterScreen,
} from '../global-filter.screens';

describe('global filter menu screens', () => {
  it("opens on the pill's editor, the reader's list or the property picker", () => {
    expect(initialGlobalFilterScreen('pill', 'gf:1', false)).toEqual({ type: 'pill', filterId: 'gf:1' });
    expect(initialGlobalFilterScreen('pill', 'gf:1', true)).toEqual({ type: 'pill', filterId: 'gf:1' });
    expect(initialGlobalFilterScreen('toolbar', undefined, false)).toEqual({ type: 'reader-list' });
    expect(initialGlobalFilterScreen('toolbar', undefined, true)).toEqual({ type: 'picker' });
    expect(initialGlobalFilterScreen('bar-add', undefined, true)).toEqual({ type: 'picker' });
  });

  it('takes a pushed screen back one step, and the builder only to the pill it came from', () => {
    expect(globalFilterScreenBackTarget({ type: 'multi-picker' }, 'toolbar')).toEqual({ type: 'multi-intro' });
    expect(globalFilterScreenBackTarget({ type: 'add-another', filterId: 'gf:1' }, 'toolbar')).toEqual({
      type: 'builder',
      filterId: 'gf:1',
    });
    expect(globalFilterScreenBackTarget({ type: 'builder', filterId: 'gf:1' }, 'pill')).toEqual({
      type: 'pill',
      filterId: 'gf:1',
    });
    // From the picker the builder ends with Done.
    expect(globalFilterScreenBackTarget({ type: 'builder', filterId: 'gf:1' }, 'toolbar')).toBeNull();

    const firstScreens: GlobalFilterMenuScreen[] = [
      { type: 'picker' },
      { type: 'reader-list' },
      { type: 'multi-intro' },
      { type: 'pill', filterId: 'gf:1' },
    ];

    firstScreens.forEach((screen) => {
      expect(globalFilterScreenBackTarget(screen, 'toolbar')).toBeNull();
      expect(globalFilterScreenBackTarget(screen, 'pill')).toBeNull();
    });
  });

  it("a sheet's header also takes the intro back to the picker it was pushed from", () => {
    expect(globalFilterSheetBackTarget({ type: 'multi-intro' }, 'toolbar', true)).toEqual({ type: 'picker' });
    expect(globalFilterSheetBackTarget({ type: 'multi-intro' }, 'bar-add', true)).toEqual({ type: 'picker' });
    // Reached from a pill's editor there is no picker behind it; a reader never has one.
    expect(globalFilterSheetBackTarget({ type: 'multi-intro' }, 'pill', true)).toBeNull();
    expect(globalFilterSheetBackTarget({ type: 'multi-intro' }, 'toolbar', false)).toBeNull();
    // Every other screen goes back as in a popover.
    expect(globalFilterSheetBackTarget({ type: 'multi-picker' }, 'toolbar', true)).toEqual({ type: 'multi-intro' });
    expect(globalFilterSheetBackTarget({ type: 'builder', filterId: 'gf:1' }, 'pill', true)).toEqual({
      type: 'pill',
      filterId: 'gf:1',
    });
    expect(globalFilterSheetBackTarget({ type: 'picker' }, 'toolbar', true)).toBeNull();
  });
});
