export const FACE_ABSENCE_LIMIT_MS = 10000;

// Once the deadline is reached, a late face sample must not reopen the attempt.
export function createPresenceGuard({ now = () => performance.now(), graceMs = FACE_ABSENCE_LIMIT_MS } = {}) {
  let missingSince = null;
  let ended = false;
  let reason = 'face_missing';
  return {
    sample({ faceCount = 0, cameraAvailable = true }) {
      const timestamp = now();
      if (ended) return { ended, reason, remainingSeconds: 0 };
      if (missingSince !== null && timestamp - missingSince >= graceMs) {
        ended = true;
        return { ended, reason, remainingSeconds: 0 };
      }
      if (cameraAvailable && faceCount > 0) missingSince = null;
      else {
        if (missingSince === null) missingSince = timestamp;
        if (!cameraAvailable) reason = 'camera_disconnected';
        else reason = 'face_missing';
      }
      return {
        ended: false,
        reason: missingSince === null ? null : reason,
        remainingSeconds: missingSince === null ? null : Math.max(0, Math.ceil((graceMs - (timestamp - missingSince)) / 1000)),
      };
    },
  };
}
