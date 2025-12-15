// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);
  
  const { organizationId, eventId } = useEvent();

  // 🔥 新增：从 localStorage 恢复用户数据
  const restoreUserFromLocalStorage = (role) => {
    try {
      const storageKey = role === 'eventManager' ? 'eventManagerInfo' : `${role}Info`;
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        const data = JSON.parse(stored);
        console.log('[AuthContext] 从 localStorage 恢复用户数据:', storageKey);
        
        // 构建 userProfile 对象
        return {
          userId: data.userId,
          organizationId: data.organizationId,
          eventId: data.eventId,
          roles: data.roles || [role],
          basicInfo: {
            englishName: data.englishName,
            chineseName: data.chineseName,
            phoneNumber: data.phoneNumber
          },
          sellerManager: data.managedDepartments ? {
            managedDepartments: data.managedDepartments
          } : undefined
        };
      }
    } catch (error) {
      console.warn('[AuthContext] localStorage 恢复失败:', error);
    }
    return null;
  };

  // 🔥 新增：从 Custom Claims 构建基本 userProfile
  const buildProfileFromClaims = (claims) => {
    if (!claims || !claims.userId || !claims.roles) {
      return null;
    }

    console.log('[AuthContext] 从 Custom Claims 构建用户数据');
    
    return {
      userId: claims.userId,
      organizationId: claims.organizationId,
      eventId: claims.eventId,
      roles: claims.roles,
      identityInfo: {
        department: claims.department || '',
        identityTag: claims.identityTag || ''
      },
      sellerManager: claims.managedDepartments ? {
        managedDepartments: claims.managedDepartments
      } : undefined
    };
  };

  // 监听 Firebase Auth 状态变化
  useEffect(() => {
    if (!organizationId || !eventId) {
      console.warn('[AuthContext] No organizationId or eventId');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[AuthContext] Auth state changed:', user ? user.uid : 'no user');
      
      if (user && !user.isAnonymous) {
        setCurrentUser(user);
        
        try {
          // 🔥 步骤 1: 获取 Custom Claims
          const idTokenResult = await user.getIdTokenResult();
          const c = idTokenResult?.claims || {};
          setClaims(c);
          console.log('[AuthContext] Loaded custom claims:', c);

          // 🔥 步骤 2: 如果已经有 userProfile（从登录时设置），直接使用
          if (userProfile && userProfile.userId) {
            console.log('[AuthContext] ✅ 使用已有的 userProfile（从登录设置）');
            setLoading(false);
            return;
          }

          // 🔥 步骤 3: 尝试从 Custom Claims 恢复基本信息
          let profile = buildProfileFromClaims(c);

          // 🔥 步骤 4: 尝试从 localStorage 补充详细信息
          if (c.roles && c.roles.length > 0) {
            const primaryRole = c.roles[0]; // 使用第一个角色
            const storedProfile = restoreUserFromLocalStorage(primaryRole);
            
            if (storedProfile) {
              // 合并 Claims 和 localStorage 的数据
              profile = {
                ...profile,
                ...storedProfile,
                // Claims 的数据优先级更高（更新）
                roles: c.roles,
                organizationId: c.organizationId || storedProfile.organizationId,
                eventId: c.eventId || storedProfile.eventId
              };
              console.log('[AuthContext] ✅ 合并 Claims + localStorage 数据');
            }
          }

          // 🔥 步骤 5: 如果还是没有，尝试从 Firestore 读取（fallback）
          if (!profile || !profile.userId) {
            console.log('[AuthContext] 尝试从 Firestore 读取用户数据...');
            
            try {
              const effOrgId = (c && c.organizationId) || organizationId;
              const effEventId = (c && c.eventId) || eventId;
              
              let firestoreProfile = await authService.getUserProfile(user.uid, effOrgId, effEventId);

              // 若因规则导致查询失败，尝试顶层 users 集合
              if (!firestoreProfile) {
                const claimedUserId = c && c.userId;
                if (claimedUserId) {
                  console.log('[AuthContext] Fallback: reading top-level users/', claimedUserId);
                  const userDocRef = doc(db, 'users', claimedUserId);
                  const userDocSnap = await getDoc(userDocRef);
                  if (userDocSnap.exists()) {
                    firestoreProfile = { id: userDocSnap.id, ...userDocSnap.data() };
                  }
                }
              }

              if (firestoreProfile) {
                profile = firestoreProfile;
                console.log('[AuthContext] ✅ 从 Firestore 读取成功');
              }
            } catch (err) {
              console.warn('[AuthContext] Firestore 读取失败（非致命错误）:', err.message);
              // 继续使用 Claims/localStorage 的数据
            }
          }

          // 🔥 步骤 6: 规范化角色名称
          if (profile) {
            const normalized = { ...profile };
            if (Array.isArray(normalized.roles)) {
              normalized.roles = normalized.roles.map(r => 
                r === 'event_manager' ? 'eventManager' : r
              );
            }
            setUserProfile(normalized);
            console.log('[AuthContext] ✅ User profile 设置完成:', {
              userId: normalized.userId,
              roles: normalized.roles,
              source: userProfile?.userId ? 'login' : profile.basicInfo ? 'localStorage' : 'claims'
            });
          } else {
            console.warn('[AuthContext] ⚠️ 无法获取用户数据');
          }

        } catch (e) {
          console.error('[AuthContext] 加载用户数据失败:', e);
          setError(e.message);
        }
      } else {
        setCurrentUser(null);
        setUserProfile(null);
        setClaims(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, [organizationId, eventId]); // 移除 userProfile 依赖，避免循环

  // 登入函数
  const login = async (phoneNumber, password) => {
    try {
      setError(null);
      setLoading(true);
      
      console.log('[AuthContext] Login called');
      
      if (!organizationId || !eventId) {
        throw new Error('无法获取组织或活动信息，请重新加载页面');
      }
      
      const result = await authService.loginWithPin(phoneNumber, password, organizationId, eventId);
      
      // 🔥 如果登录返回了用户资料，直接设置
      if (result.userProfile) {
        const normalized = { ...result.userProfile };
        if (Array.isArray(normalized.roles)) {
          normalized.roles = normalized.roles.map(r => r === 'event_manager' ? 'eventManager' : r);
        }
        setUserProfile(normalized);
        console.log('[AuthContext] User profile set from login result (normalized):', normalized);
      }
      
      return result;
    } catch (err) {
      console.error('[AuthContext] Login error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
      setCurrentUser(null);
      setUserProfile(null);
      setClaims(null);
      
      // 🔥 清除 localStorage
      ['sellerInfo', 'merchantInfo', 'customerInfo', 'eventManagerInfo', 
       'sellerManagerInfo', 'financeManagerInfo'].forEach(key => {
        localStorage.removeItem(key);
      });
      
      console.log('[AuthContext] Logout 完成，已清除所有数据');
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
      'eventManager',
      'financeManager',
      'sellerManager',
      'merchantManager',
      'customerManager',
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

  // 🔥 新增：公开的 setUserProfile 方法（供 UniversalLogin 使用）
  const updateUserProfile = (profile) => {
    console.log('[AuthContext] updateUserProfile called:', profile);
    setUserProfile(profile);
  };

  const value = {
    currentUser,
    userProfile,
    claims,
    loading,
    error,
    login,
    logout,
    hasRole,
    getPrimaryRole,
    updateUserProfile, // 🔥 新增：暴露给外部使用
    isAuthenticated: !!currentUser && !currentUser.isAnonymous
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};