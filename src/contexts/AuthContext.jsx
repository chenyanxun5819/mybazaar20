// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { authService } from '../services/authService';
import { useEvent } from './EventContext';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // 获取 EventContext（必须存在）
  const { organizationId, eventId } = useEvent();

  // 监听 Firebase Auth 状态变化
  useEffect(() => {
    // 如果没有 orgId/eventId，不执行查询
    if (!organizationId || !eventId) {
      console.warn('[AuthContext] No organizationId or eventId, skipping user profile load');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[AuthContext] Auth state changed:', user ? user.uid : 'no user');
      
      if (user && !user.isAnonymous) {
        setCurrentUser(user);
        
        // 载入用户资料
        try {
          const profile = await authService.getUserProfile(
            user.uid, 
            organizationId, 
            eventId
          );
          setUserProfile(profile);
          console.log('[AuthContext] User profile loaded:', profile);
        } catch (err) {
          console.error('[AuthContext] Failed to load user profile:', err);
          setUserProfile(null);
        }
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, [organizationId, eventId]);

  // 登入函数
  const login = async (phoneNumber, password) => {
    try {
      setError(null);
      setLoading(true);
      
      console.log('[AuthContext] Login called with:', {
        phoneNumber,
        organizationId,
        eventId
      });
      
      if (!organizationId || !eventId) {
        throw new Error('无法获取组织或活动信息，请重新加载页面');
      }
      
      const result = await authService.loginWithPin(phoneNumber, password, organizationId, eventId);
      
      // onAuthStateChanged 会自动处理后续
      return result;
    } catch (err) {
      console.error('[AuthContext] Login error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // 登出函数
  const logout = async () => {
    try {
      await authService.logout();
      setCurrentUser(null);
      setUserProfile(null);
    } catch (err) {
      console.error('[AuthContext] Logout error:', err);
      throw err;
    }
  };

  // 检查用户是否有特定角色
  const hasRole = (role) => {
    if (!userProfile || !userProfile.roles) return false;
    return userProfile.roles.includes(role);
  };

  // 获取用户主要角色（优先级最高的角色）
  const getPrimaryRole = () => {
    if (!userProfile || !userProfile.roles) return null;
    
    const rolePriority = [
      'platform_admin',
      'org_admin', 
      'event_manager',
      'manager',
      'merchant',
      'seller',
      'customer'
    ];
    
    for (const role of rolePriority) {
      if (userProfile.roles.includes(role)) {
        return role;
      }
    }
    
    return null;
  };

  const value = {
    currentUser,
    userProfile,
    loading,
    error,
    login,
    logout,
    hasRole,
    getPrimaryRole,
    isAuthenticated: !!currentUser && !currentUser.isAnonymous
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};