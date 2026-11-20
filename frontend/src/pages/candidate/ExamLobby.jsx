import React, { useState, useEffect } from 'react';
import { examAPI } from '../../services/api';
import CameraPrecheck from '../../components/CameraPrecheck';
import { Clock, BookOpen, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function ExamLobby({ onStartExam }) {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingExam, setPendingExam] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    examAPI.listExams()
      .then((data) => setExams(data))
      .catch((err) => setError('Failed to load examinations.'))
      .finally(() => setLoading(false));
  }, []);


  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {pendingExam && <CameraPrecheck exam={pendingExam} onCancel={() => setPendingExam(null)} onStarted={onStartExam} />}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Examination Lobby</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Select an active assessment below to begin or resume your session.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-6">
        {exams.map((exam) => (
          <div key={exam.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-3 max-w-2xl">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    Active Assessment
                  </span>
                  <span className="text-xs text-slate-400">ID: {exam.id.slice(0, 8)}...</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{exam.title}</h2>
                <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">{exam.description}</p>

                <div className="flex flex-wrap items-center gap-4 pt-2 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-4 h-4 text-indigo-500" />
                    <span>Duration: <strong>{Math.floor(exam.duration_seconds / 60)} mins</strong></span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <BookOpen className="w-4 h-4 text-indigo-500" />
                    <span>Total Marks: <strong>{exam.total_marks}</strong></span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>Negative Marking: <strong>0.25 penalty</strong></span>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0">
                <button
                  onClick={() => setPendingExam(exam)}
                  disabled={Boolean(pendingExam)}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
                >
                  {pendingExam?.id === exam.id ? 'Checking camera...' : 'Enter Examination'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </button>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 grid sm:grid-cols-3 gap-4 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Deterministic personalized question order</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Zero-loss durable background autosave</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Server-authoritative deadline validation</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

