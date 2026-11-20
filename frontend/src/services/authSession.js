// Each browser tab owns its login, allowing several candidates to test together.
export function createAuthSession(storage) {
  const memory = new Map();
  const read = (key) => {
    try { return storage.getItem(key); } catch { return memory.get(key) ?? null; }
  };
  const write = (key, value) => {
    memory.set(key, value);
    try { storage.setItem(key, value); } catch { /* Use memory for this visit. */ }
  };
  const remove = (key) => {
    memory.delete(key);
    try { storage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  };
  return {
    getToken: () => read('exampulse_token'),
    getUser: () => {
      try { return JSON.parse(read('exampulse_user')); } catch { return null; }
    },
    save: (token, user) => {
      write('exampulse_token', token);
      write('exampulse_user', JSON.stringify(user));
    },
    saveUser: (user) => write('exampulse_user', JSON.stringify(user)),
    clear: () => {
      remove('exampulse_token');
      remove('exampulse_user');
    },
  };
}

export const authSession = createAuthSession({
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
  removeItem: (key) => window.sessionStorage.removeItem(key),
});
