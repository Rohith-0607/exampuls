import React, { useEffect, useState } from 'react';
import { AlertTriangle, Maximize, ShieldCheck } from 'lucide-react';
import { watchExamActivity } from '../services/examActivity';

export default function ExamActivityNotice({ sessionId, active }) {
  const storageKey = `exampulse_activity_${sessionId}`;
  const [notice, setNotice] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (Number.isSafeInteger(saved?.count) && saved.count >= 0 && typeof saved.message === 'string') return saved;
    } catch { /* Storage is optional. */ }
    return { count: 0, message: '' };
  });
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [fullscreenError, setFullscreenError] = useState('');

  useEffect(() => {
    if (!active) return;
    return watchExamActivity({
      onWarning: (message) => setNotice((previous) => ({ count: previous.count + 1, message })),
    });
  }, [active]);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(notice)); } catch { /* Keep warnings usable without storage. */ }
  }, [notice, storageKey]);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const enterFullscreen = async () => {
    setFullscreenError('');
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError('Fullscreen is unavailable here. Keep this exam tab active to continue.');
    }
  };

  if (!active) return null;

  return (
    <section
      aria-label="Exam activity notifications"
      className={`border-b px-4 sm:px-8 py-3 ${notice.message
        ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100'
        : 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-100'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          {notice.message ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" /> : <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          <div>
            <div className="text-sm" role={notice.message ? 'alert' : 'status'} aria-atomic="true">
              <span className="font-bold">{notice.message ? `Exam warning (${notice.count})` : 'Stay focused on your exam'}</span>
              <p className="mt-0.5">{notice.message || 'Keep this tab active. Switching tabs or windows, copying, pasting, and leaving fullscreen will show a warning.'}</p>
            </div>
            {!notice.message && notice.count > 0 && <p className="text-xs mt-1">Warnings this session: {notice.count}</p>}
            {fullscreenError && <p className="text-xs mt-1" role="status">{fullscreenError}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!fullscreen && document.fullscreenEnabled && (
            <button type="button" onClick={enterFullscreen} className="inline-flex items-center gap-1.5 rounded-lg border border-current px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
              Fullscreen
            </button>
          )}
          {notice.message && (
            <button type="button" onClick={() => setNotice((previous) => ({ ...previous, message: '' }))} className="rounded-lg border border-current px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              I understand
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
