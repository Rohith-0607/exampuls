import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSession } from './authSession.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('three candidates keep separate tokens and profiles; logging out one does not affect the others', () => {
  const tabs = Array.from({ length: 3 }, () => createAuthSession(storage()));
  tabs.forEach((tab, index) => tab.save(`token-${index + 1}`, { id: index + 1, username: `candidate_${index + 1}` }));
  tabs.forEach((tab, index) => {
    assert.equal(tab.getToken(), `token-${index + 1}`);
    assert.equal(tab.getUser().id, index + 1);
  });
  tabs[1].clear();
  assert.equal(tabs[1].getToken(), null);
  assert.equal(tabs[0].getToken(), 'token-1');
  assert.equal(tabs[2].getToken(), 'token-3');
});

test('a refreshed tab restores its own login', () => {
  const tabStorage = storage();
  createAuthSession(tabStorage).save('candidate-token', { id: 'candidate-id' });
  const refreshed = createAuthSession(tabStorage);
  assert.equal(refreshed.getToken(), 'candidate-token');
  assert.equal(refreshed.getUser().id, 'candidate-id');
});

test('blocked storage still allows login during the current visit', () => {
  const blocked = () => { throw new Error('Storage unavailable'); };
  const tab = createAuthSession({ getItem: blocked, setItem: blocked, removeItem: blocked });
  tab.save('token', { id: 3 });
  assert.equal(tab.getToken(), 'token');
  assert.equal(tab.getUser().id, 3);
  tab.clear();
  assert.equal(tab.getToken(), null);
});
