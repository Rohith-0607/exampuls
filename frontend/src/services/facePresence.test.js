import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceGuard } from './facePresence.js';

test('a visible face keeps the attempt active indefinitely', () => {
  let time = 0;
  const guard = createPresenceGuard({ now: () => time });
  for (time = 0; time < 60000; time += 1000) {
    const result = guard.sample({ faceCount: 1 });
    assert.equal(result.ended, false);
    assert.equal(result.remainingSeconds, null);
  }
});

test('missing face warns, counts down, then ends exactly after ten seconds', () => {
  let time = 0;
  const guard = createPresenceGuard({ now: () => time });
  assert.equal(guard.sample({ faceCount: 0 }).remainingSeconds, 10);
  time = 5000;
  assert.equal(guard.sample({ faceCount: 0 }).remainingSeconds, 5);
  time = 9999;
  assert.equal(guard.sample({ faceCount: 0 }).ended, false);
  time = 10000;
  assert.deepEqual(guard.sample({ faceCount: 0 }), { ended: true, reason: 'face_missing', remainingSeconds: 0 });
});

test('returning during the grace period resets the countdown', () => {
  let time = 0;
  const guard = createPresenceGuard({ now: () => time });
  guard.sample({ faceCount: 0 });
  time = 9000;
  assert.equal(guard.sample({ faceCount: 1 }).remainingSeconds, null);
  time = 20000;
  assert.equal(guard.sample({ faceCount: 0 }).remainingSeconds, 10);
  time = 29999;
  assert.equal(guard.sample({ faceCount: 1 }).ended, false);
});

test('camera removal ends an attempt even if the last detected face was present', () => {
  let time = 0;
  const guard = createPresenceGuard({ now: () => time });
  guard.sample({ faceCount: 1 });
  time = 100;
  assert.equal(guard.sample({ faceCount: 1, cameraAvailable: false }).remainingSeconds, 10);
  time = 10100;
  assert.equal(guard.sample({ cameraAvailable: false }).reason, 'camera_disconnected');
  assert.equal(guard.sample({ faceCount: 1 }).ended, true);
});

test('a delayed browser timer cannot let a late returning face reopen the exam', () => {
  let time = 0;
  const guard = createPresenceGuard({ now: () => time });
  guard.sample({ faceCount: 0 });
  time = 20000;
  assert.equal(guard.sample({ faceCount: 1 }).ended, true);
});

test('100,000 randomized samples follow the ten-second rule and never reopen an ended attempt', () => {
  let seed = Number(process.env.CAMERA_TEST_SEED ?? 241103);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trace = 0; trace < 1000; trace++) {
    let time = 0;
    let missingAt = null;
    let ended = false;
    const guard = createPresenceGuard({ now: () => time });
    for (let step = 0; step < 100; step++) {
      time += Math.floor(random() * 1500);
      const cameraAvailable = random() > 0.12;
      const faceCount = random() > 0.35 ? 1 : 0;
      if (missingAt !== null && time - missingAt >= 10000) ended = true;
      if (!ended) {
        if (cameraAvailable && faceCount) missingAt = null;
        else missingAt ??= time;
      }
      const actual = guard.sample({ cameraAvailable, faceCount });
      assert.equal(actual.ended, ended, `trace=${trace}, step=${step}`);
      assert.equal(actual.remainingSeconds, ended ? 0 : missingAt === null ? null : Math.ceil((10000 - (time - missingAt)) / 1000));
    }
  }
});
