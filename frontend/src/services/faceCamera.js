async function loadFaceDetector() {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const baseUrl = import.meta.env?.BASE_URL ?? '/';
  const vision = await FilesetResolver.forVisionTasks(`${baseUrl}mediapipe/wasm`);
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${baseUrl}models/blaze_face_short_range.tflite`, delegate: 'CPU' },
    runningMode: 'VIDEO', minDetectionConfidence: 0.6,
  });
}

export async function openFaceCamera({
  mediaDevices = globalThis.navigator?.mediaDevices,
  secureContext = globalThis.isSecureContext,
  loadDetector = loadFaceDetector,
  now = () => performance.now(),
  repeat = setInterval,
  cancel = clearInterval,
} = {}) {
  if (!secureContext || !mediaDevices?.getUserMedia) {
    throw new Error('Camera access requires HTTPS or localhost in a supported browser.');
  }
  const stream = await mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  let detector;
  try {
    detector = await loadDetector();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Face detection could not load. Check your connection and retry the camera check.', { cause: error });
  }

  let video = null;
  let stopped = false;
  let lastFrame = -1;
  let lastFrameAt = now();
  let lastSample = { faceCount: 0, cameraAvailable: true, checking: true, timestamp: now() };
  const subscribers = new Set();
  const emit = (sample) => {
    lastSample = { ...sample, timestamp: now() };
    subscribers.forEach((subscriber) => subscriber(lastSample));
  };
  const tracks = stream.getVideoTracks();
  const cameraLost = () => emit({ faceCount: 0, cameraAvailable: false });
  tracks.forEach((track) => {
    track.addEventListener('ended', cameraLost);
    track.addEventListener('mute', cameraLost);
  });
  const timer = repeat(() => {
    if (stopped) return;
    // Release a camera if its UI disappears (logout, cancelled check, or hot reload).
    if (video && !video.isConnected) {
      if (now() - lastFrameAt > 2000) stop();
      return;
    }
    if (video && video.srcObject !== stream) {
      stop();
      return;
    }
    if (!tracks.some((track) => track.readyState === 'live' && track.enabled && !track.muted)) {
      cameraLost();
      return;
    }
    if (!video || video.readyState < 2 || video.currentTime === lastFrame) {
      if (now() - lastFrameAt > 2000) cameraLost();
      return;
    }
    lastFrame = video.currentTime;
    lastFrameAt = now();
    try {
      const result = detector.detectForVideo(video, performance.now());
      emit({ faceCount: result.detections.length, cameraAvailable: true, checking: false });
    } catch {
      cameraLost();
    }
  }, 400);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancel(timer);
    subscribers.clear();
    tracks.forEach((track) => {
      track.removeEventListener('ended', cameraLost);
      track.removeEventListener('mute', cameraLost);
    });
    stream.getTracks().forEach((track) => track.stop());
    if (video?.srcObject === stream) video.srcObject = null;
    detector.close();
  }

  return {
    get sample() { return lastSample; },
    async attach(element) {
      if (stopped) throw new Error('The camera has stopped. Retry the camera check.');
      if (video && video !== element && video.srcObject === stream) video.srcObject = null;
      video = element;
      lastFrame = -1;
      lastFrameAt = now();
      element.srcObject = stream;
      await element.play();
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(lastSample);
      return () => subscribers.delete(subscriber);
    },
    stop,
  };
}
