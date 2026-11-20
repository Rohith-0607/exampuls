import React, { useState, useEffect, useRef } from 'react';
import { examAPI } from '../../services/api';
import ExamActivityNotice from '../../components/ExamActivityNotice';
import ExamCameraMonitor from '../../components/ExamCameraMonitor';
import CameraPrecheck from '../../components/CameraPrecheck';
import {
  Clock, AlertTriangle, CheckCircle, Save, RotateCcw, 
  ChevronLeft, ChevronRight, Flag, Bookmark, Send, Award
} from 'lucide-react';

export default function ExamPortal({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { qId: { answer: 'A', isMarked: false, version: 1 } }
  const [autosaveState, setAutosaveState] = useState('saved'); // 'saved', 'saving', 'error'
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [endReason, setEndReason] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`exampulse_camera_ended_${initialSession.session_id}`);
      return ['face_missing', 'camera_disconnected'].includes(saved) ? saved : null;
    } catch { return null; }
  });
  const endReasonRef = useRef(endReason);
  endReasonRef.current = endReason;
  const submissionLock = useRef(false);
  const pendingSaves = useRef(new Set());
  const submitRef = useRef(null);

  useEffect(() => {
    if (submissionResult || endReason) session.camera?.stop();
  }, [submissionResult, endReason, session.camera]);

  useEffect(() => {
    if (!endReason || submissionResult || loading) return;
    submitRef.current();
    const retry = setInterval(() => submitRef.current(), 3000);
    return () => clearInterval(retry);
  }, [endReason, submissionResult, loading]);

  const endForCamera = (reason) => {
    if (endReasonRef.current || submissionResult) return;
    endReasonRef.current = reason;
    try { sessionStorage.setItem(`exampulse_camera_ended_${session.session_id}`, reason); } catch { /* Retry in memory when storage is blocked. */ }
    setEndReason(reason);
    setShowSubmitModal(false);
    session.camera?.stop();
  };

  const saveAnswerTracked = async (...args) => {
    const request = examAPI.saveAnswer(...args);
    pendingSaves.current.add(request);
    try { return await request; } finally { pendingSaves.current.delete(request); }
  };

  // 1. Initial Load: Fetch questions & prior saved answers
  useEffect(() => {
    async function loadExamData() {
      try {
        setLoading(true);
        // Check if already submitted
        if (session.status === 'submitted') {
          const sub = await examAPI.getSubmission(session.session_id);
          setSubmissionResult(sub);
          setLoading(false);
          return;
        }

        const [qData, aData, statusData] = await Promise.all([
          examAPI.getQuestions(session.session_id),
          examAPI.getAnswers(session.session_id),
          examAPI.getSessionStatus(session.session_id),
        ]);

        setQuestions(qData);
        setRemainingSeconds(statusData.remaining_seconds);

        // Populate answers map
        const ansMap = {};
        aData.forEach((a) => {
          ansMap[a.question_id] = {
            answer: a.selected_answer,
            isMarked: a.is_marked_for_review,
            version: a.version,
          };
        });
        setAnswers(ansMap);
      } catch (err) {
        setErrorMessage('Failed to load examination state. Please refresh.');
      } finally {
        setLoading(false);
      }
    }
    loadExamData();
  }, [session.session_id]);

  // 2. Authoritative Timer Countdown
  useEffect(() => {
    if (remainingSeconds === null || submissionResult) return;

    if (remainingSeconds <= 0) {
      handleFinalSubmit();
      return;
    }

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [remainingSeconds, submissionResult]);

  // 3. Answer Selection with Durable Background Autosave
  const handleSelectAnswer = async (selectedOptionId) => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult || endReasonRef.current || submissionLock.current) return;

    const existing = answers[currentQ.id] || { isMarked: false, version: 0 };
    const nextVersion = existing.version + 1;

    // 1. Immediate optimistic UI update
    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        answer: selectedOptionId,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');

    // 2. Durable backend persist
    try {
      await saveAnswerTracked(
        session.session_id,
        currentQ.id,
        selectedOptionId,
        existing.isMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 4. Clear Answer
  const handleClearAnswer = async () => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult || endReasonRef.current || submissionLock.current) return;

    const existing = answers[currentQ.id] || { isMarked: false, version: 0 };
    const nextVersion = existing.version + 1;

    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        answer: null,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');
    try {
      await saveAnswerTracked(
        session.session_id,
        currentQ.id,
        null,
        existing.isMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 5. Toggle Mark for Review
  const handleToggleMark = async () => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult || endReasonRef.current || submissionLock.current) return;

    const existing = answers[currentQ.id] || { answer: null, isMarked: false, version: 0 };
    const nextMarked = !existing.isMarked;
    const nextVersion = existing.version + 1;

    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        isMarked: nextMarked,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');
    try {
      await saveAnswerTracked(
        session.session_id,
        currentQ.id,
        existing.answer,
        nextMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 6. Submit Exam
  const handleFinalSubmit = async () => {
    if (submissionLock.current || submissionResult) return;
    submissionLock.current = true;
    setSubmitting(true);
    setErrorMessage('');
    try {
      await Promise.allSettled([...pendingSaves.current]);
      const res = await examAPI.submitExam(session.session_id, endReasonRef.current);
      setSubmissionResult(res);
      setShowSubmitModal(false);
    } catch (err) {
      setErrorMessage(err.response?.data?.detail || 'Failed to submit examination.');
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };
  submitRef.current = handleFinalSubmit;

  // Timer Formatting
  const formatTime = (secs) => {
    if (secs === null) return '--:--';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // --- Post Submission Results Screen ---
  if (submissionResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Award className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">{submissionResult.termination_reason || endReason ? 'Examination Ended' : 'Examination Submitted!'}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
            {submissionResult.termination_reason || endReason
              ? 'The attempt ended because your face was out of view or the camera stopped for 10 seconds. Your saved answers have been submitted. This attempt cannot be resumed.'
              : 'Your answers have been securely recorded and evaluated by the server.'}
          </p>

          <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="block text-xs uppercase font-semibold text-slate-400">Score</span>
              <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {submissionResult.score} / {submissionResult.total_marks}
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase font-semibold text-slate-400">Correct</span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{submissionResult.correct_count}</span>
            </div>
            <div>
              <span className="block text-xs uppercase font-semibold text-slate-400">Incorrect</span>
              <span className="text-2xl font-bold text-rose-500">{submissionResult.incorrect_count}</span>
            </div>
            <div>
              <span className="block text-xs uppercase font-semibold text-slate-400">Unanswered</span>
              <span className="text-2xl font-bold text-slate-600 dark:text-slate-300">{submissionResult.unanswered_count}</span>
            </div>
          </div>

          <button
            onClick={onExit}
            className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm transition"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!session.camera && !endReason) {
    return <CameraPrecheck exam={{ id: session.examination_id, title: session.title }} onCancel={onExit} onStarted={(next) => setSession((previous) => ({ ...previous, ...next }))} />;
  }

  const currentQ = questions[currentIndex] || {};
  const currentAnswerData = answers[currentQ.id] || {};
  const answeredCount = Object.values(answers).filter((a) => a.answer !== null && a.answer !== undefined).length;
  const markedCount = Object.values(answers).filter((a) => a.isMarked).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Top Authoritative Bar */}
      <div className="sticky top-16 z-20">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{session.title}</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Session ID: {session.session_id.slice(0, 8)}...</span>
        </div>

        <div className="flex items-center space-x-4">
          {/* Autosave Status Badge */}
          <div className="flex items-center space-x-1.5 text-xs font-medium px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
            {autosaveState === 'saving' && (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
                <span className="text-amber-700 dark:text-amber-300">Saving...</span>
              </>
            )}
            {autosaveState === 'saved' && (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-700 dark:text-emerald-300">Saved</span>
              </>
            )}
            {autosaveState === 'error' && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                <span className="text-rose-700 dark:text-rose-300">Retrying save...</span>
              </>
            )}
          </div>

          {/* Server-Authoritative Timer */}
          <div
            className={`flex items-center space-x-2 font-mono text-sm font-bold px-3 py-1.5 rounded-xl border ${
              remainingSeconds !== null && remainingSeconds < 300
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 animate-pulse'
                : 'bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Clock className="w-4 h-4 text-indigo-500" />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          {/* Submit Button */}
          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={Boolean(endReason) || submitting}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-sm"
          >
            Submit Exam
          </button>
        </div>
      </div>

      <ExamActivityNotice
        key={session.session_id}
        sessionId={session.session_id}
        active={!submitting && !endReason && remainingSeconds > 0 && questions.length > 0}
      />
      </div>
      {endReason && <div role="alert" className="m-4 rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950 p-4 text-rose-900 dark:text-rose-100"><strong>Attempt ended: camera rule exceeded.</strong> Questions are locked while your saved answers are submitted.{errorMessage && <p className="mt-2">{errorMessage} Retrying automatically. Keep this page open.</p>}</div>}
      {/* Main Examination Work Area */}
      <fieldset disabled={Boolean(endReason) || submitting} className="flex-1 max-w-7xl w-full min-w-0 mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 border-0">
        {/* Left Pane: Question & Options (8 cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
              <span className="text-xs uppercase font-bold tracking-wider px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Marks: <strong>{currentQ.marks}</strong> (Negative: -0.25)</span>
            </div>

            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed mb-6">
              {currentQ.question_text}
            </h3>

            {/* MCQ Options list */}
            <div className="space-y-3">
              {currentQ.options &&
                currentQ.options.map((opt) => {
                  const isSelected = currentAnswerData.answer === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectAnswer(opt.id)}
                      className={`w-full text-left p-4 rounded-xl border text-sm transition flex items-start space-x-3.5 ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-300 font-medium ring-1 ring-indigo-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5 ${
                          isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt.id}
                      </span>
                      <span className="flex-1">{opt.text}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Action Navigation Footer */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleToggleMark}
                className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                  currentAnswerData.isMarked
                    ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                <span>{currentAnswerData.isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
              </button>

              {currentAnswerData.answer && (
                <button
                  type="button"
                  onClick={handleClearAnswer}
                  className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Selection</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="inline-flex items-center space-x-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <button
                type="button"
                disabled={currentIndex === questions.length - 1}
                onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                className="inline-flex items-center space-x-1 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium disabled:opacity-40 transition"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Pane: Question Palette (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <ExamCameraMonitor camera={session.camera} active={!endReason && remainingSeconds > 0} onEnd={endForCamera} />
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Question Palette</h4>

            {/* Quick Summary Counts */}
            <div className="grid grid-cols-3 gap-2 mb-6 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
                <span className="block text-emerald-800 dark:text-emerald-300 font-bold text-base">{answeredCount}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Answered</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700">
                <span className="block text-slate-800 dark:text-slate-200 font-bold text-base">{unansweredCount}</span>
                <span className="text-slate-500 dark:text-slate-400 font-medium">Unanswered</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-800">
                <span className="block text-purple-800 dark:text-purple-300 font-bold text-base">{markedCount}</span>
                <span className="text-purple-600 dark:text-purple-400 font-medium">Marked</span>
              </div>
            </div>

            {/* Numbered Palette Buttons */}
            <div className="grid grid-cols-5 gap-2 max-h-[360px] overflow-y-auto p-1">
              {questions.map((q, idx) => {
                const ans = answers[q.id];
                const hasAnswer = ans && ans.answer !== null && ans.answer !== undefined;
                const isMarked = ans && ans.isMarked;
                const isCurrent = idx === currentIndex;

                let btnClass = 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950'; // Unanswered
                if (hasAnswer && isMarked) {
                  btnClass = 'bg-purple-600 border-purple-600 text-white font-bold ring-2 ring-purple-300';
                } else if (isMarked) {
                  btnClass = 'bg-purple-100 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-semibold';
                } else if (hasAnswer) {
                  btnClass = 'bg-emerald-600 border-emerald-600 text-white font-semibold';
                }

                if (isCurrent) {
                  btnClass += ' ring-2 ring-indigo-600 ring-offset-2 dark:ring-offset-slate-900';
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-10 rounded-xl border text-xs flex items-center justify-center transition shadow-2xs ${btnClass}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </fieldset>

      {/* Confirmation Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-xl border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Submit Examination?</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              Please review your question progress before finalizing your submission:
            </p>

            <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2 mb-6 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Total Questions:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{questions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-700 dark:text-emerald-300">Answered Questions:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300">{answeredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Unanswered Questions:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">{unansweredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-purple-700 dark:text-purple-300">Marked for Review:</span>
                <span className="font-bold text-purple-700 dark:text-purple-300">{markedCount}</span>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs rounded-xl border border-rose-200 dark:border-rose-800">
                {errorMessage}
              </div>
            )}

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="w-1/2 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-50 dark:hover:bg-slate-950 transition"
              >
                Continue Exam
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinalSubmit}
                className="w-1/2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Confirm Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

