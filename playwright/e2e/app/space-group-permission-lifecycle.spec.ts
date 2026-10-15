import { test } from '@playwright/test';

import { SpaceGroupPermissionLifecycle } from '../../support/space-group-permission-lifecycle';

test.use({ trace: 'off', video: 'off' });

test.describe('Owned space group permissions in open editors', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });
  test.skip(!process.env.APPFLOWY_GROUP_PERMISSION_RUNTIME_DIR,
    'Opt-in: requires a passed server lifecycle, current native proofs and exclusive released fixture');

  test('View/Edit/revoke, membership, overlapping grants, follower tab and stale allowance', async ({ context }, info) => {
    const run = new SpaceGroupPermissionLifecycle(context, info);
    let passed = false;
    let failure: unknown;
    let restorationFailure: unknown;

    try {
      await run.prepare();
      const primary = await run.open('primary');

      await run.open('direct');
      await run.open('second');
      await run.open('primary', 'follower');
      await run.expectAccess('view', 'initial-view');
      for (const [level, access, phase] of [
        [30, 'edit', 'explicit-edit'], [10, 'view', 'explicit-view'],
        [null, 'denied', 'grant-removed'], [10, 'view', 'grant-readded'],
      ] as const) {
        await test.step(phase, async () => {
          const before = await run.revisionCounts();

          await run.grant(level);
          await run.expectRevisionAfter(before);
          await run.expectAccess(access, phase);
        });
      }

      for (const present of [false, true]) {
        await test.step(present ? 'member-readded' : 'member-removed', async () => {
          const before = await run.revisionCounts();

          await run.membership(present);
          await run.expectRevisionAfter(before);
          await run.expectAccess(present ? 'view' : 'denied', present ? 'member-readded' : 'member-removed');
        });
      }

      await test.step('A delivered stale allowance cannot restore a revoked editor', async () => {
        run.holdNextPrimaryAllowance(primary);
        const allowedRevision = await run.revisionCounts();

        await run.grant(30);
        await run.expectHeld();
        await run.expectRevisionAfter(allowedRevision);
        const revokedRevision = await run.revisionCounts();

        await run.grant(null);
        await run.expectRevisionAfter(revokedRevision);
        await run.expectAccess('denied', 'revoked-with-allowance-held');
        await run.releaseStaleAllowance(primary);
      });
      await test.step('Regrant restores every open editor and the owner sees the explicit group setting', async () => {
        const before = await run.revisionCounts();

        await run.grant(10);
        await run.expectRevisionAfter(before);
        await run.expectAccess('view', 'final-recovered-view');
        await run.captureOwnerAssignment();
      });
      passed = true;
    } catch (error) {
      failure = error;
      await run.captureFailure(error);
    } finally {
      try { await run.finish(passed); }
      catch (restorationError) { restorationFailure = restorationError; }
    }

    if (failure && restorationFailure) throw new AggregateError([failure, restorationFailure],
      'UI assertion and restoration both failed; private journal retains each error');
    if (failure) throw failure;
    if (restorationFailure) throw restorationFailure;
  });
});
