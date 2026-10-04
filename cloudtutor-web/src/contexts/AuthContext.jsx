import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  sdkLogin,
  sdkRegister,
  sdkConfirmCode,
  sdkResendCode,
  sdkLogout,
  isCognitoConfigured,
  getCognitoConfig
} from '../api/auth';

const AuthContext = createContext(null);

const AUTH_STORAGE_KEY = 'cloudtutor_auth_session';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMockMode, setIsMockMode] = useState(!isCognitoConfigured);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        // If live Cognito is active now, clear any previous mock sessions
        if (isCognitoConfigured && session.isMock) {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          setUser(null);
          setIdToken(null);
          setAccessToken(null);
          setIsMockMode(false);
        } else {
          setUser(session.user);
          setIdToken(session.idToken);
          setAccessToken(session.accessToken);
          setIsMockMode(session.isMock ?? !isCognitoConfigured);
        }
      } else {
        setIsMockMode(!isCognitoConfigured);
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
    setIsMockMode(result.isMock ?? !isCognitoConfigured);

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      user: result.user,
      idToken: result.idToken,
      accessToken: result.accessToken,
      isMock: result.isMock ?? !isCognitoConfigured
    }));

    return result;
  };

  const register = async (email, password, name) => {
    return sdkRegister(email, password, name);
  };

  const confirmCode = async (email, code) => {
    return sdkConfirmCode(email, code);
  };

  const resendCode = async (email) => {
    return sdkResendCode(email);
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
    cognitoConfig: getCognitoConfig(),
    login,
    register,
    confirmCode,
    resendCode,
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
