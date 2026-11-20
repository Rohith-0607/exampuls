import test from 'node:test';
import assert from 'node:assert/strict';
import { openFaceCamera } from './faceCamera.js';

function harness() {
  let clock = 0;
  let tick;
  let faces = 1;
  let closes = 0;
  let stops = 0;
  const track = Object.assign(new EventTarget(), { readyState: 'live', enabled: true, muted: false,
    stop() { this.readyState = 'ended'; stops++; },
  });
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { isConnected: true, readyState: 4, currentTime: 0, srcObject: null, play: async () => {} };
  const options = {
    mediaDevices: { getUserMedia: async () => stream }, secureContext: true,
    loadDetector: async () => ({ detectForVideo: () => ({ detections: Array(faces).fill({}) }), close: () => { closes++; } }),
    now: () => clock, repeat: (callback) => { tick = callback; return 1; }, cancel: () => { tick = null; },
  };
  return { options, stream, track, video, faces: (count) => { faces = count; },
    advance(ms = 400, freshFrame = true) { clock += ms; if (freshFrame) video.currentTime += ms / 1000; tick?.(); },
    get closes() { return closes; }, get stops() { return stops; },
  };
}

test('a stopped older camera cannot disconnect the replacement camera preview', async () => {
  const old = harness();
  const replacement = harness();
  const first = await openFaceCamera(old.options);
  const second = await openFaceCamera(replacement.options);
  await first.attach(old.video);
  await second.attach(old.video);
  first.stop();
  assert.equal(old.video.srcObject, replacement.stream);
  assert.equal(replacement.stops, 0);
  second.stop();
});

test('model loading failure releases the camera immediately', async () => {
  const fake = harness();
  fake.options.loadDetector = async () => { throw new Error('model unavailable'); };
  await assert.rejects(openFaceCamera(fake.options), /Face detection could not load/);
  assert.equal(fake.stops, 1);
});

test('replacing a stream releases the older camera without stopping the new one', async () => {
  const old = harness();
  const replacement = harness();
  const first = await openFaceCamera(old.options);
  const second = await openFaceCamera(replacement.options);
  await first.attach(old.video);
  await second.attach(old.video);
  old.advance();
  assert.equal(old.stops, 1);
  assert.equal(old.video.srcObject, replacement.stream);
  assert.equal(replacement.stops, 0);
  first.stop();
  second.stop();
});

test('permission denial and insecure access do not start a detector', async () => {
  const fake = harness();
  let loads = 0;
  fake.options.loadDetector = async () => { loads++; };
  await assert.rejects(openFaceCamera({ ...fake.options, secureContext: false }), /HTTPS or localhost/);
  fake.options.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(openFaceCamera(fake.options), { name: 'NotAllowedError' });
  assert.equal(loads, 0);
});

test('repeat 100 camera lifecycles: detect, lose face, freeze video, disconnect, clean up', async () => {
  for (let iteration = 0; iteration < 100; iteration++) {
    const fake = harness();
    const camera = await openFaceCamera(fake.options);
    await camera.attach(fake.video);
    fake.advance();
    assert.equal(camera.sample.faceCount, 1);
    fake.faces(0);
    fake.advance();
    assert.equal(camera.sample.faceCount, 0);
    fake.faces(1);
    fake.advance();
    assert.equal(camera.sample.faceCount, 1);
    fake.advance(2500, false);
    assert.equal(camera.sample.cameraAvailable, false);
    fake.advance();
    assert.equal(camera.sample.cameraAvailable, true);
    fake.track.readyState = 'ended';
    fake.track.dispatchEvent(new Event('ended'));
    assert.equal(camera.sample.cameraAvailable, false);
    camera.stop();
    camera.stop();
    assert.equal(fake.stops, 1);
    assert.equal(fake.closes, 1);
    assert.equal(fake.video.srcObject, null);
  }
});
