import React, { createContext, useContext, useState, useEffect } from 'react';
import { sdkLogin, sdkRegister, sdkConfirmCode, sdkLogout } from '../api/auth';
import { MOCK_USER } from '../api/mockData';

const AuthContext = createContext(null);

const AUTH_STORAGE_KEY = 'cloudtutor_auth_session';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMockMode, setIsMockMode] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        setUser(session.user);
        setIdToken(session.idToken);
        setAccessToken(session.accessToken);
        setIsMockMode(session.isMock ?? true);
      }
    } catch (e) {
      console.error('Failed to parse cached auth session:', e);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const result = await sdkLogin(email, password);
    setUser(result.user);
    setIdToken(result.idToken);
    setAccessToken(result.accessToken);
    setIsMockMode(result.isMock ?? true);

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      user: result.user,
      idToken: result.idToken,
      accessToken: result.accessToken,
      isMock: result.isMock ?? true
    }));

    return result;
  };

  const register = async (email, password, name) => {
    return sdkRegister(email, password, name);
  };

  const confirmCode = async (email, code) => {
    return sdkConfirmCode(email, code);
  };

  const logout = () => {
    if (user?.email) {
      sdkLogout(user.email);
    }
    setUser(null);
    setIdToken(null);
    setAccessToken(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const quickDemoLogin = async () => {
    return login('student@cloudtutor.edu.vn', 'DemoPassword123!');
  };

  const value = {
    user,
    idToken,
    accessToken,
    isAuthenticated: Boolean(idToken),
    isLoading,
    isMockMode,
    login,
    register,
    confirmCode,
    logout,
    quickDemoLogin
  };

  return (
    <AuthContext.Provider value={value}>
      {!isLoading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
