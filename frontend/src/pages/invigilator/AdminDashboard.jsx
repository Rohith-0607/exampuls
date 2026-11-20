import React, { useState, useEffect, useRef } from 'react';
import { adminAPI, examAPI } from '../../services/api';
import {
  Users, CheckCircle2, Clock, AlertTriangle, ShieldAlert,
  Trophy, RefreshCw, Radio, Search, Filter, Eye
} from 'lucide-react';

export default function AdminDashboard() {
  const [examId, setExamId] = useState(null);
  const [overview, setOverview] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [suspiciousActivity, setSuspiciousActivity] = useState([]);
  const [activeTab, setActiveTab] = useState('candidates'); // 'candidates', 'leaderboard', 'collusion'
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [candidatePage, setCandidatePage] = useState(0);
  const pageSize = 100;
  const refreshRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // 1. Fetch exams and initial data
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const exams = await examAPI.listExams();
        if (exams.length > 0) {
          const currentExamId = exams[0].id;
          setExamId(currentExamId);
          await refreshAllData(currentExamId);
        }
      } catch (err) {
        console.error('Error initializing admin dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const refreshAllData = async (eId) => {
    try {
      const [ov, cands, lb, susp] = await Promise.all([
        adminAPI.getOverview(eId),
        adminAPI.getCandidates(eId, { limit: pageSize, offset: candidatePage * pageSize, search: searchTerm, status: statusFilter }),
        adminAPI.getLeaderboard(eId),
        adminAPI.getSuspiciousActivity(eId),
      ]);
      setOverview(ov);
      setCandidates(cands);
      setLeaderboard(lb);
      setSuspiciousActivity(susp);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    }
  };
  refreshRef.current = refreshAllData;

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      adminAPI.getCandidates(examId, { limit: pageSize, offset: candidatePage * pageSize, search: searchTerm, status: statusFilter })
        .then((data) => { if (!cancelled) setCandidates(data); })
        .catch((error) => console.error('Error loading candidate page:', error));
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [examId, candidatePage, searchTerm, statusFilter]);

  // 2. Real-Time WebSocket Connection to Distributed Bus
  useEffect(() => {
    if (!examId) return;

    let socket;
    let pingInterval;
    let reconnectTimer;
    let refreshTimer;
    let disposed = false;

    function connectWS() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/admin/exams/${examId}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsConnected(true);
        pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send('ping');
          }
        }, 15000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // If a candidate started, answered, or submitted, refresh live metrics
          if (['candidate_started', 'answer_saved', 'candidate_submitted'].includes(msg.type)) {
            if (!refreshTimer) {
              refreshTimer = setTimeout(() => {
                refreshTimer = null;
                refreshRef.current(examId);
              }, 1000);
            }
          }
        } catch (e) {
          // pong or non-json message
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        clearInterval(pingInterval);
        // Retry connection after 3s
        if (!disposed) reconnectTimer = setTimeout(connectWS, 3000);
      };
    }

    connectWS();

    return () => {
      disposed = true;
      clearInterval(pingInterval);
      clearTimeout(reconnectTimer);
      clearTimeout(refreshTimer);
      if (socket) socket.close();
    };
  }, [examId]);

  if (loading || !overview) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Filter candidates
  const filteredCandidates = candidates;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Invigilator Command Center</h1>
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              ></span>
              <span className={wsConnected ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
                {wsConnected ? 'Real-Time Bus Active' : 'Connecting Event Bus...'}
              </span>
            </div>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{overview.title}</p>
        </div>

        <button
          onClick={() => refreshAllData(examId)}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 shadow-2xs transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Snapshot</span>
        </button>
      </div>

      {/* Metrics Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Registered</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{overview.total_registered}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">In-Progress</span>
            <Radio className="w-4 h-4 text-amber-500 animate-pulse" />
          </div>
          <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{overview.active_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Submitted</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{overview.submitted_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Not Started</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <span className="text-2xl font-bold text-slate-600 dark:text-slate-300">{overview.not_started_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xs col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Collusion Flags</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">{overview.suspicious_count}</span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-700 flex space-x-8">
        <button
          onClick={() => setActiveTab('candidates')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'candidates'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Live Candidates ({candidates.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'leaderboard'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>Live Leaderboard ({leaderboard.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('collusion')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'collusion'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Collusion Detection ({suspiciousActivity.length})</span>
        </button>
      </div>

      {/* Tab 1: Live Candidates Monitor */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidate code or name..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCandidatePage(0); }}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCandidatePage(0); }}
                className="border border-slate-200 dark:border-slate-700 rounded-xl text-xs py-2 px-3 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900"
              >
                <option value="all">All Statuses</option>
                <option value="in_progress">In-Progress</option>
                <option value="submitted">Submitted</option>
                <option value="not_started">Not Started</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Candidate Code</th>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Progress (Answered / Total)</th>
                    <th className="py-3 px-4">Review Marked</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Flags</th>
                    <th className="py-3 px-4">Last Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredCandidates.map((c) => (
                    <tr key={c.candidate_id} className="hover:bg-slate-50 dark:hover:bg-slate-950 transition">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{c.candidate_code}</td>
                      <td className="py-3 px-4 font-medium">{c.display_name}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full font-semibold ${
                            c.status === 'in_progress'
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                              : c.status === 'submitted'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{c.answered_count} / 20</span>
                          <div className="w-20 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-1.5 rounded-full"
                              style={{ width: `${(c.answered_count / 20) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {c.marked_count > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-semibold">
                            {c.marked_count} marked
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-bold text-indigo-600 dark:text-indigo-400">
                        {c.score !== null ? `${c.score} pts` : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {c.is_suspicious ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Flagged</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">Clean</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {c.last_activity ? new Date(c.last_activity).toLocaleTimeString() : 'No activity'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-700 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
              <span>{candidates.length ? `Showing ${candidatePage * pageSize + 1}-${candidatePage * pageSize + candidates.length}` : 'No candidates on this page'} · {overview.total_registered.toLocaleString()} registered</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={candidatePage === 0} onClick={() => setCandidatePage((page) => Math.max(0, page - 1))} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40">Previous</button>
                <span>Page {candidatePage + 1}</span>
                <button type="button" disabled={candidates.length < pageSize} onClick={() => setCandidatePage((page) => page + 1)} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Live Leaderboard */}
      {activeTab === 'leaderboard' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xs">
          {leaderboard.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              No submissions recorded yet. Rankings will appear as candidates complete their exams.
            </div>
          ) : (
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Candidate Code</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4">Correct</th>
                  <th className="py-3 px-4">Incorrect</th>
                  <th className="py-3 px-4">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leaderboard.map((item) => (
                  <tr key={item.candidate_code} className="hover:bg-slate-50 dark:hover:bg-slate-950 transition">
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold ${
                          item.rank === 1
                            ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                            : item.rank === 2
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                            : item.rank === 3
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{item.candidate_code}</td>
                    <td className="py-3 px-4 font-medium">{item.display_name}</td>
                    <td className="py-3 px-4 font-bold text-base text-indigo-600 dark:text-indigo-400">{item.score} pts</td>
                    <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 font-semibold">{item.correct_count}</td>
                    <td className="py-3 px-4 text-rose-500 font-semibold">{item.incorrect_count}</td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {item.submitted_at ? new Date(item.submitted_at).toLocaleTimeString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Collusion Detection */}
      {activeTab === 'collusion' && (
        <div className="space-y-4">
          {suspiciousActivity.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-slate-400 text-sm">
              No collusion patterns detected across active submissions.
            </div>
          ) : (
            <div className="grid gap-4">
              {suspiciousActivity.map((flag) => (
                <div key={flag.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-rose-200 dark:border-rose-800 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {flag.candidate_a_code} & {flag.candidate_b_code}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300">
                            {flag.risk_level} Risk
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{flag.reason}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-xs uppercase font-semibold text-slate-400">Similarity Score</span>
                      <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                        {(flag.similarity_score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                    <span className="font-bold text-slate-700 dark:text-slate-300 block">Statistical Evidence:</span>
                    <pre className="text-[11px] text-slate-600 dark:text-slate-300 overflow-x-auto font-mono bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                      {JSON.stringify(flag.evidence, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

