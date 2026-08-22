import {
  canUseChildViewCreationActions,
  canUsePageHistoryAction,
  canUseViewMutationActions,
} from '@/components/app/view-actions/viewActionPermission';

const readOnly = {
  can_read: true,
  can_write: false,
  can_share: false,
};

describe('canonical object capabilities for view actions', () => {
  it('fails closed before object permission has loaded', () => {
    expect(canUseViewMutationActions({})).toBe(false);
    expect(canUsePageHistoryAction({})).toBe(false);
    expect(canUseChildViewCreationActions({})).toBe(false);
  });

  it('uses can_share for page management actions', () => {
    expect(canUseViewMutationActions({ objectPermission: readOnly })).toBe(false);
    expect(
      canUseViewMutationActions({
        objectPermission: { ...readOnly, can_share: true },
      })
    ).toBe(true);
  });

  it('uses can_write independently for history and child creation', () => {
    const writable = { ...readOnly, can_write: true };

    expect(canUsePageHistoryAction({ objectPermission: writable })).toBe(true);
    expect(canUseChildViewCreationActions({ objectPermission: writable })).toBe(true);
    expect(canUseViewMutationActions({ objectPermission: writable })).toBe(false);
  });

  it('requires can_read even if another capability is unexpectedly true', () => {
    const unreadable = {
      can_read: false,
      can_write: true,
      can_share: true,
    };

    expect(canUseViewMutationActions({ objectPermission: unreadable })).toBe(false);
    expect(canUsePageHistoryAction({ objectPermission: unreadable })).toBe(false);
    expect(canUseChildViewCreationActions({ objectPermission: unreadable })).toBe(false);
  });
});
