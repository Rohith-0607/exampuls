import React, { useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle } from 'lucide-react';
import { openFaceCamera } from '../services/faceCamera';
import { examAPI } from '../services/api';

export default function CameraPrecheck({ exam, onStarted, onCancel }) {
  const videoRef = useRef(null);
  const cameraRef = useRef(null);
  const transferred = useRef(false);
  const mounted = useRef(true);
  const unsubscribeRef = useRef(null);
  const operationRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Enable your camera and keep your face clearly visible.');
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      unsubscribeRef.current?.();
      if (!transferred.current) cameraRef.current?.stop();
    };
  }, []);

  const enableCamera = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError('');
    setReady(false);
    cameraRef.current?.stop();
    try {
      const camera = await openFaceCamera();
      if (!mounted.current) { camera.stop(); return; }
      cameraRef.current = camera;
      await camera.attach(videoRef.current);
      if (!mounted.current) { camera.stop(); return; }
      let visibleSince = null;
      unsubscribeRef.current = camera.subscribe((sample) => {
        const visible = sample.cameraAvailable && !sample.checking && sample.faceCount === 1;
        if (visible) visibleSince ??= performance.now();
        else visibleSince = null;
        setReady(visible && performance.now() - visibleSince >= 2000);
        setStatus(!sample.cameraAvailable ? 'Camera unavailable. Reconnect it and retry.'
          : sample.faceCount > 1 ? 'Keep only your face in the camera view.'
          : !visible ? 'No face detected. Face the camera in good lighting.'
          : performance.now() - visibleSince < 2000 ? 'Face detected. Hold still for two seconds.'
          : 'Camera check passed. You can start the exam.');
      });
    } catch (failure) {
      cameraRef.current?.stop();
      if (mounted.current) setError(failure.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site and retry.' : failure.name === 'NotFoundError' ? 'No camera was found. Connect a camera before starting.' : failure.message);
    } finally {
      operationRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const startExam = async () => {
    if (operationRef.current) return;
    const camera = cameraRef.current;
    if (!ready || !camera || camera.sample.faceCount !== 1 || !camera.sample.cameraAvailable || performance.now() - camera.sample.timestamp > 1500) {
      setReady(false);
      setStatus('The camera check is not ready. Keep your face visible or retry the camera.');
      return;
    }
    operationRef.current = true;
    setStartingExam(true);
    setBusy(true);
    setError('');
    try {
      const session = await examAPI.startExam(exam.id);
      if (!mounted.current) return;
      transferred.current = true;
      onStarted({ ...session, camera });
    } catch (failure) {
      if (mounted.current) { setError(failure.response?.data?.detail || 'Unable to start the exam. Please retry.'); setBusy(false); }
    } finally {
      operationRef.current = false;
      if (mounted.current) setStartingExam(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="camera-check-title" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl">
        <h2 id="camera-check-title" className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Camera className="w-5 h-5" /> Camera check required</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{exam.title}</p>
        <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera preview" className="mt-4 w-full aspect-video rounded-xl bg-slate-950 object-cover -scale-x-100" />
        <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200" role="status">{status}</p>
        <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-100"><AlertTriangle className="inline w-4 h-4 mr-1" /> Keep your face visible throughout the exam. If your face disappears or the camera stops for 10 seconds, the attempt ends and saved answers are submitted.</p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Face presence is checked on your device. Camera images and audio are not recorded or uploaded.</p>
        {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onCancel} disabled={startingExam} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm disabled:opacity-50">Cancel</button>
          <button type="button" onClick={enableCamera} disabled={busy} className="px-4 py-2 rounded-lg border border-indigo-600 text-indigo-700 dark:text-indigo-300 text-sm disabled:opacity-50">{busy ? 'Please wait...' : 'Enable / retry camera'}</button>
          <button type="button" onClick={startExam} disabled={!ready || busy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">Start exam with camera</button>
        </div>
      </section>
    </div>
  );
}
