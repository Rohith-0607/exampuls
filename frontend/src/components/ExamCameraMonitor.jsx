import React, { useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle } from 'lucide-react';
import { createPresenceGuard } from '../services/facePresence';

export default function ExamCameraMonitor({ camera, active, onEnd }) {
  const videoRef = useRef(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [status, setStatus] = useState({ remainingSeconds: null, ended: false });

  useEffect(() => {
    if (!active) return;
    const guard = createPresenceGuard();
    let sample = camera?.sample || { faceCount: 0, cameraAvailable: false, timestamp: performance.now() };
    const unsubscribe = camera?.subscribe((value) => { sample = value; });
    camera?.attach(videoRef.current).catch(() => { sample = { faceCount: 0, cameraAvailable: false, timestamp: performance.now() }; });
    const timer = setInterval(() => {
      const fresh = performance.now() - sample.timestamp < 2500;
      const result = guard.sample({ faceCount: fresh ? sample.faceCount : 0, cameraAvailable: fresh && sample.cameraAvailable });
      setStatus(result);
      if (result.ended) {
        clearInterval(timer);
        onEndRef.current(result.reason);
      }
    }, 250);
    return () => { clearInterval(timer); unsubscribe?.(); };
  }, [camera, active]);

  return (
    <section className={`rounded-2xl border p-4 ${status.remainingSeconds !== null || status.ended
      ? 'bg-rose-50 border-rose-300 dark:bg-rose-950 dark:border-rose-800'
      : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700'}`} aria-label="Exam camera monitor">
      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Camera className="w-4 h-4" /> Camera monitoring</h4>
      <video ref={videoRef} muted playsInline autoPlay aria-label="Live camera preview" className="mt-3 w-full aspect-video rounded-xl bg-slate-950 object-cover -scale-x-100" />
      <div className="mt-3 text-sm" role={status.remainingSeconds !== null ? 'alert' : 'status'} aria-atomic="true">
        {status.ended ? <p className="font-semibold text-rose-800 dark:text-rose-200">Camera rule exceeded. Ending this attempt...</p>
          : status.remainingSeconds !== null ? <p className="font-semibold text-rose-800 dark:text-rose-200"><AlertTriangle className="inline w-4 h-4 mr-1" /> {status.reason === 'camera_disconnected' ? 'Camera stopped.' : 'No face detected.'} Return now: exam ends in {status.remainingSeconds}s.</p>
          : <p className="text-emerald-700 dark:text-emerald-300">Face visible. Keep the camera on.</p>}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">10 seconds out of view ends the attempt. Video stays on your device.</p>
    </section>
  );
}
