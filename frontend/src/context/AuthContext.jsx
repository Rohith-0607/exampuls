import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';
import { authSession } from '../services/authSession';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(authSession.getUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = authSession.getToken();
    if (token) {
      authAPI.getMe()
        .then((profile) => {
          setUser(profile);
          authSession.saveUser(profile);
        })
        .catch(() => {
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const data = await authAPI.login(username, password);
    const profile = {
      id: data.user_id,
      username: username,
      role: data.role,
      candidate_id: data.candidate_id,
      display_name: data.display_name,
    };
    setUser(profile);
    authSession.save(data.access_token, profile);
    return profile;
  };

  const logout = () => {
    authSession.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

