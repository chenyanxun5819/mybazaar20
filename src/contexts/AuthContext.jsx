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
  
  const { organizationId, eventId, orgCode, eventCode } = useEvent();

  // 从 localStorage 恢复用户数据
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

  // ✅ 修改：从 Custom Claims 检查用户是否有权限访问当前事件
  const buildProfileFromClaims = (claims) => {
    // 检查 claims 基本结构
    if (!claims || !claims.authUid || !claims.events) {
      console.log('[AuthContext] Claims 缺少必要字段 (authUid 或 events)');
      return null;
    }

    // 检查当前事件是否在用户的事件列表中
    const currentEventKey = `${orgCode}-${eventCode}`;
    const hasAccess = claims.events.includes(currentEventKey);

    console.log('[AuthContext] 检查事件访问权限:', {
      currentEventKey,
      userEvents: claims.events,
      hasAccess
    });

    if (!hasAccess) {
      console.log('[AuthContext] ⚠️ 用户未参与当前事件');
      return null;
    }

    // 返回基本标记，实际用户数据需要从 Firestore 查询
    return {
      authUid: claims.authUid,
      needsFirestoreLoad: true  // 标记需要从 Firestore 加载完整数据
    };
  };

  // ⭐ 新增：根据用户角色获取导航路径
  const getNavigationPath = (profile) => {
    if (!profile || !profile.roles || profile.roles.length === 0) {
      console.warn('[AuthContext] 无法获取导航路径：缺少角色信息');
      return '/login';
    }

    const roles = profile.roles;
    
    // 构建 orgEventCode
    let orgEventCode = '';
    
    // 尝试从多个来源获取 codes
    if (orgCode && eventCode) {
      orgEventCode = `${orgCode}-${eventCode}`;
    } else if (profile.organizationCode && profile.eventCode) {
      orgEventCode = `${profile.organizationCode}-${profile.eventCode}`;
    } else {
      console.warn('[AuthContext] 无法构建 orgEventCode，使用默认值');
      orgEventCode = 'unknown-event';
    }

    console.log('[AuthContext] 🧭 获取导航路径:', {
      roles,
      orgEventCode,
      source: orgCode ? 'EventContext' : profile.organizationCode ? 'userProfile' : 'none'
    });

    // 角色优先级判断（从高到低）
    if (roles.includes('platformAdmin') || roles.includes('platform_admin')) {
      return '/platform/admin';
    }
    
    if (roles.includes('eventManager') || roles.includes('event_manager')) {
      return `/event-manager/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('sellerManager')) {
      return `/seller-manager/${orgEventCode}/dashboard`;
    }
    
    // ⭐⭐⭐ Finance Manager 导航 ⭐⭐⭐
    if (roles.includes('financeManager')) {
      console.log('[AuthContext] ✅ 导航到 Finance Manager Dashboard');
      return `/finance-manager/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('merchantManager')) {
      return `/merchant-manager/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('customerManager')) {
      return `/customer-manager/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('customer')) {
      return `/customer/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('seller')) {
      return `/seller/${orgEventCode}/dashboard`;
    }
    
    if (roles.includes('merchant')) {
      return `/merchant/${orgEventCode}/dashboard`;
    }

    console.warn('[AuthContext] ⚠️ 未识别的角色，返回登录页:', roles);
    return '/login';
  };

  // 监听 Firebase Auth 状态变化
  useEffect(() => {
    if (!organizationId || !eventId) {
      console.warn('[AuthContext] No organizationId or eventId');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // ✅ 检测是否在登录页面（用于静默处理警告）
      const isLoginPage = window.location.pathname.includes('/login');
      
      console.log('[AuthContext] Auth state changed:', user ? user.uid : 'no user');
      
      if (user && !user.isAnonymous) {
        setCurrentUser(user);
        
        try {
          // 步骤 1: 获取 Custom Claims
          const idTokenResult = await user.getIdTokenResult();
          const c = idTokenResult?.claims || {};
          setClaims(c);
          console.log('[AuthContext] Loaded custom claims:', c);

          // 步骤 2: 如果已经有 userProfile（从登录时设置），直接使用
          if (userProfile && userProfile.userId) {
            console.log('[AuthContext] ✅ 使用已有的 userProfile（从登录设置）');
            setLoading(false);
            return;
          }

          // ✅ 步骤 3: 从 Custom Claims 检查权限
          let profile = buildProfileFromClaims(c);

          if (!profile) {
            // 用户没有权限访问当前事件
            console.log('[AuthContext] ⚠️ 用户未参与当前事件，清除登录状态');
            
            if (!isLoginPage) {
              console.warn('[AuthContext] 需要重新登录');
            }
            
            try {
              await auth.signOut();
            } catch (signOutErr) {
              // 忽略错误
            }
            
            setLoading(false);
            return;
          }

          // ✅ 步骤 4: 从 Firestore 加载完整用户数据
          if (profile.needsFirestoreLoad) {
            console.log('[AuthContext] 从 Firestore 加载用户数据...', {
              authUid: profile.authUid,
              organizationId,
              eventId
            });

            try {
              // 查询路径：organizations/{orgId}/events/{eventId}/users/{authUid}
              const userDocRef = doc(
                db, 
                'organizations', organizationId,
                'events', eventId,
                'users', profile.authUid
              );
              
              const userDocSnap = await getDoc(userDocRef);

              if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                profile = {
                  id: userDocSnap.id,
                  ...userData,
                  organizationCode: orgCode,
                  eventCode: eventCode
                };
                console.log('[AuthContext] ✅ 从 Firestore 加载成功:', {
                  userId: profile.userId,
                  roles: profile.roles,
                  englishName: profile.basicInfo?.englishName
                });
              } else {
                console.error('[AuthContext] ❌ Firestore 中找不到用户文档');
                profile = null;
              }
            } catch (err) {
              console.error('[AuthContext] ❌ Firestore 查询失败:', err);
              profile = null;
            }
          }

          // ✅ 步骤 5: 如果仍然没有数据，清除登录状态
          if (!profile) {
            if (!isLoginPage) {
              console.warn('[AuthContext] ⚠️ 无法获取用户数据，需要重新登录');
            }
            
            try {
              await auth.signOut();
            } catch (signOutErr) {
              // 忽略错误
            }
            
            setLoading(false);
            return;
          }

          // 步骤 6: 规范化角色名称
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

          }
        } catch (e) {
          // ✅ 根据页面类型决定日志级别
          if (isLoginPage) {
            console.warn('[AuthContext] 加载用户数据失败（登录页面）:', e.message);
          } else {
            console.error('[AuthContext] 加载用户数据失败:', e);
          }
          setError(e.message);
          
          // ✅ 出错时也清除 Auth 状态
          try {
            await auth.signOut();
          } catch (signOutErr) {
            // 忽略 signOut 错误
          }
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
      
      // 如果登录返回了用户资料，直接设置
      if (result.userProfile) {
        const normalized = { ...result.userProfile };
        if (Array.isArray(normalized.roles)) {
          normalized.roles = normalized.roles.map(r => r === 'event_manager' ? 'eventManager' : r);
        }
        
        // ⭐ 添加 organizationCode 和 eventCode（用于导航）
        normalized.organizationCode = orgCode;
        normalized.eventCode = eventCode;
        
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
      
      // 清除 localStorage
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
      'platformAdmin',
      'org_admin', 
      'eventManager',
      'event_manager',
      'financeManager',      // ⭐ Finance Manager
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

  // 公开的 setUserProfile 方法（供 UniversalLogin 使用）
  const updateUserProfile = (profile) => {
    console.log('[AuthContext] updateUserProfile called:', profile);
    
    // ⭐ 确保包含 organizationCode 和 eventCode
    const enrichedProfile = {
      ...profile,
      organizationCode: profile.organizationCode || orgCode,
      eventCode: profile.eventCode || eventCode
    };
    
    setUserProfile(enrichedProfile);
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
    updateUserProfile,
    getNavigationPath,     // ⭐⭐⭐ 新增：导航路径辅助函数 ⭐⭐⭐
    isAuthenticated: !!currentUser && !currentUser.isAnonymous
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};