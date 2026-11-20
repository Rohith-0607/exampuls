import test from 'node:test';
import assert from 'node:assert/strict';
import { watchExamActivity } from './examActivity.js';

function beforeUnloadEvent() {
  const event = new Event('beforeunload', { cancelable: true });
  // A browser BeforeUnloadEvent has a writable string returnValue. Node 20's
  // generic Event only exposes a getter, so model the browser-specific field.
  Object.defineProperty(event, 'returnValue', { value: '', writable: true });
  return event;
}

function setup() {
  const doc = new EventTarget();
  const win = new EventTarget();
  doc.visibilityState = 'visible';
  doc.fullscreenElement = null;
  let focused = true;
  doc.hasFocus = () => focused;
  const warnings = [];
  const stop = watchExamActivity({ doc, win, onWarning: (message) => warnings.push(message) });
  return { doc, win, warnings, stop, focus: (value) => { focused = value; } };
}

test('a tab switch counts once across blur and visibility events, and a second departure counts again', async () => {
  const guard = setup();
  guard.focus(false);
  guard.win.dispatchEvent(new Event('blur'));
  guard.doc.visibilityState = 'hidden';
  guard.doc.dispatchEvent(new Event('visibilitychange'));
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(guard.warnings.length, 1);
  guard.doc.visibilityState = 'visible';
  guard.focus(true);
  guard.doc.dispatchEvent(new Event('visibilitychange'));
  guard.win.dispatchEvent(new Event('focus'));
  guard.doc.visibilityState = 'hidden';
  guard.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(guard.warnings.length, 2);
  guard.stop();
});

test('switching to another window warns even when the document remains visible', async () => {
  const guard = setup();
  guard.focus(false);
  guard.win.dispatchEvent(new Event('blur'));
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(guard.warnings.length, 1);
  guard.stop();
});

test('brief focus changes and regular exam interaction do not warn', async () => {
  const guard = setup();
  guard.focus(false);
  guard.win.dispatchEvent(new Event('blur'));
  guard.focus(true);
  guard.win.dispatchEvent(new Event('focus'));
  guard.doc.dispatchEvent(new Event('click'));
  guard.doc.dispatchEvent(new Event('keydown'));
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(guard.warnings.length, 0);
  guard.stop();
});

test('fullscreen entry is allowed, exit warns, and leaving while hidden is counted once', () => {
  const guard = setup();
  guard.doc.fullscreenElement = {};
  guard.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(guard.warnings.length, 0);
  guard.doc.fullscreenElement = null;
  guard.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.match(guard.warnings[0], /exited fullscreen/);
  guard.doc.fullscreenElement = {};
  guard.doc.dispatchEvent(new Event('fullscreenchange'));
  guard.doc.visibilityState = 'hidden';
  guard.doc.dispatchEvent(new Event('visibilitychange'));
  guard.doc.fullscreenElement = null;
  guard.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(guard.warnings.length, 2);
  guard.stop();
});

test('clipboard, right-click, and printing produce notifications', () => {
  const guard = setup();
  for (const action of ['copy', 'cut', 'paste', 'contextmenu']) guard.doc.dispatchEvent(new Event(action));
  guard.win.dispatchEvent(new Event('beforeprint'));
  assert.equal(guard.warnings.length, 5);
  guard.stop();
});

test('leaving an active exam requests browser confirmation; cleanup removes every listener and pending warning', async () => {
  const guard = setup();
  const leaving = beforeUnloadEvent();
  guard.win.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);
  assert.equal(leaving.returnValue, '');
  guard.focus(false);
  guard.win.dispatchEvent(new Event('blur'));
  guard.stop();
  await new Promise((resolve) => setTimeout(resolve, 180));
  guard.doc.visibilityState = 'hidden';
  guard.doc.dispatchEvent(new Event('visibilitychange'));
  guard.doc.dispatchEvent(new Event('paste'));
  const afterCleanup = beforeUnloadEvent();
  guard.win.dispatchEvent(afterCleanup);
  assert.equal(afterCleanup.defaultPrevented, false);
  assert.equal(guard.warnings.length, 0);
});
