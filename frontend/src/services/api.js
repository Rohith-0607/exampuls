import axios from 'axios';
import { authSession } from './authSession';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = authSession.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if unauthorized
      authSession.clear();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    return res.data;
  },
  getMe: async () => {
    const res = await api.get('/auth/me');
    return res.data;
  },
};

export const examAPI = {
  listExams: async () => {
    const res = await api.get('/exams');
    return res.data;
  },
  getExam: async (examId) => {
    const res = await api.get(`/exams/${examId}`);
    return res.data;
  },
  startExam: async (examId) => {
    const res = await api.post(`/exams/${examId}/start`);
    return res.data;
  },
  getSessionStatus: async (sessionId) => {
    const res = await api.get(`/sessions/${sessionId}`);
    return res.data;
  },
  getQuestions: async (sessionId) => {
    const res = await api.get(`/sessions/${sessionId}/questions`);
    return res.data;
  },
  getAnswers: async (sessionId) => {
    const res = await api.get(`/sessions/${sessionId}/answers`);
    return res.data;
  },
  saveAnswer: async (sessionId, questionId, selectedAnswer, isMarked = false, version = 1) => {
    const res = await api.put(`/sessions/${sessionId}/answers/${questionId}`, {
      selected_answer: selectedAnswer,
      is_marked_for_review: isMarked,
      version: version,
    });
    return res.data;
  },
  submitExam: async (sessionId, reason = null) => {
    const res = await api.post(`/sessions/${sessionId}/submit`, null, { params: reason ? { reason } : {} });
    return res.data;
  },
  getSubmission: async (sessionId) => {
    const res = await api.get(`/sessions/${sessionId}/submission`);
    return res.data;
  },
};

export const adminAPI = {
  getOverview: async (examId) => {
    const res = await api.get(`/admin/exams/${examId}/overview`);
    return res.data;
  },
  getCandidates: async (examId, params = {}) => {
    const res = await api.get(`/admin/exams/${examId}/candidates`, { params });
    return res.data;
  },
  getLeaderboard: async (examId) => {
    const res = await api.get(`/admin/exams/${examId}/leaderboard`);
    return res.data;
  },
  getSuspiciousActivity: async (examId) => {
    const res = await api.get(`/admin/exams/${examId}/suspicious-activity`);
    return res.data;
  },
};

export default api;

