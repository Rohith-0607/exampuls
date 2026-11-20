// Browser signals indicate that attention left the exam, not what happened elsewhere.
export function watchExamActivity({ doc = document, win = window, onWarning }) {
  let away = false;
  let blurTimer;
  let wasFullscreen = Boolean(doc.fullscreenElement);
  const listeners = [];
  const listen = (target, event, handler) => {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  };
  const warnAway = () => {
    if (away) return;
    away = true;
    onWarning('You left the exam tab or window. Stay on this page until you submit your exam.');
  };
  const resume = () => {
    if (doc.visibilityState === 'visible' && doc.hasFocus()) {
      clearTimeout(blurTimer);
      away = false;
    }
  };

  listen(win, 'blur', () => {
    // A tab switch emits both blur and visibilitychange; count it once.
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (!doc.hasFocus() || doc.visibilityState === 'hidden') warnAway();
    }, 150);
  });
  listen(win, 'focus', resume);
  listen(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      clearTimeout(blurTimer);
      warnAway();
    } else {
      resume();
    }
  });
  listen(doc, 'fullscreenchange', () => {
    const fullscreen = Boolean(doc.fullscreenElement);
    if (wasFullscreen && !fullscreen && !away) {
      if (doc.visibilityState === 'hidden' || !doc.hasFocus()) warnAway();
      else onWarning('You exited fullscreen. Return to fullscreen and continue your exam.');
    }
    wasFullscreen = fullscreen;
  });
  for (const action of ['copy', 'cut', 'paste', 'contextmenu']) {
    listen(doc, action, () => {
      const message = action === 'contextmenu'
        ? 'Right-clicking was detected. Use the exam controls to continue.'
        : `${action === 'paste' ? 'Pasting' : action === 'cut' ? 'Cutting' : 'Copying'} was detected. Keep your work within the exam.`;
      onWarning(message);
    });
  }
  listen(win, 'beforeprint', () => onWarning('Printing was detected. Keep the exam on screen until you submit.'));
  listen(win, 'beforeunload', (event) => {
    // Browsers display their own confirmation text when leaving an active exam.
    event.preventDefault();
    event.returnValue = '';
  });

  return () => {
    clearTimeout(blurTimer);
    listeners.forEach((remove) => remove());
  };
}
