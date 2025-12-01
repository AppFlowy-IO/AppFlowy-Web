import * as Y from 'yjs';
import { expect } from '@jest/globals';
import { editorsBetween } from '@/application/services/js-services/history';

describe('permanent user data', () => {
  it('should return users who made edits between two snapshots', () => {
    const user1 = 'uid1';
    const user2 = 'uid2';

    const d1 = new Y.Doc();
    const m1 = d1.getMap('map');
    const p1 = new Y.PermanentUserData(d1);
    p1.setUserMapping(d1, d1.clientID, user1);

    const d2 = new Y.Doc({ guid: d1.guid });
    const m2 = d2.getMap('map');
    const p2 = new Y.PermanentUserData(d2);
    p2.setUserMapping(d2, d2.clientID, user2);

    // make updates on docs
    m1.set('A', 'a1');
    m1.set('B', 'b1');
    const s1 = Y.snapshot(d1);
    let editors = editorsBetween(null, s1, p2);
    expect(Array.from(editors)).toEqual([user1]); // only changes made are by user1

    // exchange updates
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    expect(m2.toJSON()).toEqual({'A': 'a1', 'B': 'b1'});

    // compare additive changes
    m2.set('A', 'a2');
    const s2 = Y.snapshot(d2);
    editors = editorsBetween(s1, s2, p2);
    expect(Array.from(editors)).toEqual([user2]); // only change between s1->s2 was set(A, a2) made by user 2

    // compare destructive changes
    m2.delete('B');
    const s3 = Y.snapshot(d2);
    editors = editorsBetween(s2, s3, p2);
    expect(Array.from(editors)).toEqual([user2]); // only change between s2->s3 was delete(B) made by user 2

    // compare remote changes
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
    expect(m1.toJSON()).toEqual({'A': 'a2'});

    editors = editorsBetween(s2, s3, p1);
    expect(Array.from(editors)).toEqual([user2]);
  })
})