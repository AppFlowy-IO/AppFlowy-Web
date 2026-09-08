import { evaluateCompatibility, normalizeVersion, updateBannerSession, type BannerSession } from '../evaluate';
import policy from '../web-server-compatibility.json';

const evaluate = (serverVersion?: string, minClientVersion?: string, clientVersion = '0.17.1') =>
  evaluateCompatibility({ clientVersion, serverVersion, minClientVersion });

describe('web/server compatibility', () => {
  it.each([
    [' v0.18.1-premium+42 ', '0.18.1'],
    ['V0.18.1-stateless', '0.18.1'],
    ['0.18.1-pubsub', '0.18.1'],
    ['0.18.1-migrate-af-collab', '0.18.1'],
    ['0.18.1-rc.1+42', '0.18.1-rc.1'],
    ['0.18.1-beta.2', '0.18.1-beta.2'],
    ['manual-20260908', undefined],
    ['', undefined],
    ['0.18', undefined],
    ['01.18.0', undefined],
  ])('normalizes %s consistently with desktop', (raw, expected) => {
    expect(normalizeVersion(raw)?.version).toBe(expected);
  });

  it.each([
    ['0.17.9', 'server-too-old'],
    ['0.18.0', 'server-too-old'],
    ['0.18.0-premium', 'server-too-old'],
    ['0.18.1-rc.1', 'server-too-old'],
    ['0.18.1', 'compatible'],
    ['0.18.1-premium', 'compatible'],
    ['99.0.0', 'compatible'],
    ['', 'unknown'],
    [undefined, 'unknown'],
    ['manual-build', 'unknown'],
  ])('evaluates the installed client against server %s', (server, type) => {
    expect(evaluate(server).type).toBe(type);
  });

  it('uses the range for the client release, rather than comparing app and server versions directly', () => {
    expect(evaluate('0.17.0', undefined, '0.17.0').type).toBe('compatible');
    expect(evaluate('0.17.0')).toEqual({
      type: 'server-too-old',
      clientVersion: '0.17.1',
      serverVersion: '0.17.0',
      requiredServerVersion: '0.18.1',
    });
  });

  it.each([undefined, '', 'manual-build', '0.17.0', '0.17.1', '0.20.1'])('does not deprecate for floor %s', (floor) => {
    expect(evaluate('0.18.1', floor).type).toBe('compatible');
  });

  it('warns above the installed version, including at the clamp', () => {
    for (const floor of ['0.17.2', policy.max_enforceable_client_floor]) {
      expect(evaluate('0.18.1', floor)).toMatchObject({
        type: 'client-too-old',
        requiredClientVersion: floor,
        remedyReachable: true,
      });
    }
  });

  it('lets the client floor dominate and detects a contradictory deployment', () => {
    expect(evaluate('0.17.0', '0.17.2')).toMatchObject({ type: 'client-too-old', remedyReachable: false });
    expect(evaluate('manual-build', '0.17.2')).toMatchObject({ type: 'client-too-old', remedyReachable: true });
  });

  it('fails open for an unknown or unreviewed installed build', () => {
    expect(evaluate('0.1.0', undefined, 'manual-build')).toEqual({ type: 'unknown', reason: 'client-version' });
    expect(evaluate('0.1.0', undefined, '0.17.2')).toEqual({ type: 'unknown', reason: 'unreviewed-client' });
    expect(evaluate('0.18.1', '0.17.3', '0.17.2').type).toBe('client-too-old');
  });

  it('keeps the bundled policy monotone and its reviewed range below the clamp', () => {
    expect(policy.rows[0]).toMatchObject({ client_from: '0.0.0', min_server: '0.0.0' });
    for (let i = 1; i < policy.rows.length; i += 1) {
      expect(normalizeVersion(policy.rows[i].client_from)?.compare(policy.rows[i - 1].client_from)).toBe(1);
      expect(normalizeVersion(policy.rows[i].min_server)?.compare(policy.rows[i - 1].min_server)).toBeGreaterThanOrEqual(
        0
      );
      expect(policy.rows[i].reason).not.toBe('');
    }

    expect(normalizeVersion(policy.max_enforceable_client_floor)?.compare(policy.reviewed_through_client_version)).toBe(
      1
    );
    expect(
      normalizeVersion(policy.reviewed_through_client_version)?.compare(policy.rows[policy.rows.length - 1].client_from)
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('session dismissal identity', () => {
  it('keeps the same warning dismissed through outages and server patch changes', () => {
    let session: BannerSession = { serverUrl: '', dismissed: false };

    session = updateBannerSession(session, evaluate('0.17.0'), 'https://server/');
    session = { ...session, dismissed: true };
    expect(updateBannerSession(session, evaluate(undefined), 'https://SERVER')).toBe(session);
    expect(updateBannerSession(session, evaluate('0.17.1'), 'https://server')).toBe(session);
  });

  it('resets for a changed demand, server, remedy or confirmed compatibility', () => {
    const session = {
      ...updateBannerSession({ serverUrl: '', dismissed: false }, evaluate('0.18.1', '0.17.2'), 'a'),
      dismissed: true,
    };

    for (const [verdict, server] of [
      [evaluate('0.18.1', '0.17.3'), 'a'],
      [evaluate('0.18.1', '0.17.2'), 'b'],
      [evaluate('0.17.0', '0.17.2'), 'a'],
      [evaluate('0.18.1'), 'a'],
      [evaluate(undefined), 'b'],
    ] as const) {
      expect(updateBannerSession(session, verdict, server).dismissed).toBe(false);
    }
  });
});
