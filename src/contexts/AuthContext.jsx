// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
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

  // ⭐ 新增：手動刷新用戶資料
  const refreshProfile = async () => {
    if (!currentUser || !organizationId || !eventId) {
      console.warn('[AuthContext] 無法刷新 Profile: 缺少必要資訊', { 
        hasUser: !!currentUser, 
        organizationId, 
        eventId 
      });
      return null;
    }

    console.log('[AuthContext] 🔄 正在手動刷新用戶資料...');
    try {
      const profile = await loadUserProfile(currentUser.uid);
      if (profile) {
        const normalized = normalizeProfile(profile);
        setUserProfile(normalized);
        console.log('[AuthContext] ✅ Profile 刷新成功');
        return normalized;
      }
    } catch (err) {
      console.error('[AuthContext] ❌ Profile 刷新失敗:', err);
    }
    return null;
  };

  // 提取：規範化 Profile
  const normalizeProfile = (profile) => {
    if (!profile) return null;
    const normalized = { ...profile };
    if (Array.isArray(normalized.roles)) {
      normalized.roles = normalized.roles.map(r => 
        r === 'event_manager' ? 'eventManager' : r
      );
    }
    // 保險：若 identityTag 沒在頂層，嘗試從 identityInfo 提升
    if (!normalized.identityTag && normalized.identityInfo?.identityTag) {
      normalized.identityTag = normalized.identityInfo.identityTag;
    }
    return normalized;
  };

  // 提取：從 Firestore 加載 Profile
  const loadUserProfile = async (targetAuthUid) => {
    if (!organizationId || !eventId || !targetAuthUid) return null;

    let loadedProfile = null;

    // A. 優先檢查是否為 Event Manager (Legacy Check)
    // ⚠️ 注意：如果此處讀取失敗（例如權限不足），我們應該捕獲錯誤並繼續嘗試從 users 集合讀取
    try {
      const eventDocRef = doc(db, 'organizations', organizationId, 'events', eventId);
      const eventDocSnap = await getDoc(eventDocRef);
      
      if (eventDocSnap.exists()) {
        const eventData = eventDocSnap.data();
        if (eventData.eventManager && eventData.eventManager.authUid === targetAuthUid) {
          loadedProfile = {
            userId: targetAuthUid,
            ...eventData.eventManager,
            // 修正：不要在這裡強制覆寫 roles，先給予基礎角色，後續與 Firestore/Claims 合併
            roles: eventData.eventManager.roles || ['eventManager'],
            organizationCode: orgCode,
            eventCode: eventCode,
            organizationId: organizationId,
            eventId: eventId,
            basicInfo: {
              englishName: eventData.eventManager.englishName,
              chineseName: eventData.eventManager.chineseName,
              phoneNumber: eventData.eventManager.phoneNumber,
              hasDefaultPassword: eventData.eventManager.hasDefaultPassword,
              isFirstLogin: eventData.eventManager.isFirstLogin,
              transactionPinHash: eventData.eventManager.transactionPinHash
            }
          };
        }
      } 
    } catch (err) {
      console.warn('[AuthContext] Legacy Event Manager check failed (ignoring):', err);
      // 繼續執行 Part B
    }
      
    // B. 從 users 集合加載完整資料並合併
    try {
      const userDocRef = doc(db, 'organizations', organizationId, 'events', eventId, 'users', targetAuthUid);
      let userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        const usersRef = collection(db, 'organizations', organizationId, 'events', eventId, 'users');
        const q = query(usersRef, where('authUid', '==', targetAuthUid), limit(1));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          userDocSnap = qSnap.docs[0];
        }
      }

      if (userDocSnap && userDocSnap.exists()) {
        const userData = userDocSnap.data();
        
        // 如果已經有 Legacy Profile，則合併 roles
        if (loadedProfile) {
          const combinedRoles = Array.from(new Set([
            ...(loadedProfile.roles || []),
            ...(userData.roles || [])
          ]));
          
          loadedProfile = {
            ...loadedProfile,
            ...userData,
            roles: combinedRoles,
            userId: userDocSnap.id
          };
        } else {
          loadedProfile = {
            id: userDocSnap.id,
            userId: userDocSnap.id,
            ...userData,
            organizationCode: orgCode,
            eventCode: eventCode,
            organizationId: organizationId,
            eventId: eventId
          };
        }
      }
    } catch (err) {
      console.error('[AuthContext] User profile load failed:', err);
    }

    return loadedProfile;
  };

  // 从 localStorage 恢复用户数据
  const restoreUserFromLocalStorage = (role) => {
    try {
      let storageKey;
      
      // ⭐ 根据角色确定 localStorage 键名
      if (role === 'eventManager') {
        storageKey = 'eventManagerInfo';
      } else if (role === 'merchantOwner') {
        storageKey = 'merchantOwnerInfo';
      } else if (role === 'merchantAsist') {
        storageKey = 'merchantAsistInfo';
      } else {
        storageKey = `${role}Info`;
      }
      
      let stored = localStorage.getItem(storageKey);
      
      // ⭐ 兼容性处理：如果没有找到新键名，尝试旧键名 merchantInfo
      if (!stored && (role === 'merchantOwner' || role === 'merchantAsist')) {
        stored = localStorage.getItem('merchantInfo');
        if (stored) {
          console.log('[AuthContext] 🔄 迁移旧的 merchantInfo 到', storageKey);
          // 迁移到新键名
          localStorage.setItem(storageKey, stored);
          localStorage.removeItem('merchantInfo');
        }
      }
      
      if (stored) {
        const data = JSON.parse(stored);
        console.log('[AuthContext] 从 localStorage 恢复用户数据:', storageKey);
        
        // 构建 userProfile 对象
        return {
          userId: data.userId,
          organizationId: data.organizationId,
          eventId: data.eventId,
          roles: data.roles || [role],
          // ✅ 添加 identityTag（如果有）
          identityTag: data.identityTag,
          // ✅ 添加 identityInfo（如果有）
          identityInfo: data.identityInfo ? {
            identityId: data.identityInfo.identityId,
            identityTag: data.identityInfo.identityTag,
            identityName: data.identityInfo.identityName,
            department: data.identityInfo.department,
            position: data.identityInfo.position
          } : undefined,
          basicInfo: {
            englishName: data.englishName,
            chineseName: data.chineseName,
            phoneNumber: data.phoneNumber
          },
          teamLeader: data.managedDepartments ? {
            managedDepartments: data.managedDepartments
          } : undefined,
          // ⭐ 添加 merchantOwner 和 merchantAsist 特定数据
          merchantOwner: (role === 'merchantOwner' && data.merchantId) ? {
            merchantId: data.merchantId,
            stallName: data.stallName
          } : undefined,
          merchantAsist: (role === 'merchantAsist' && data.merchantId) ? {
            merchantId: data.merchantId,
            merchantOwnerId: data.merchantOwnerId,
            stallName: data.stallName
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
    // 1. 兼容新版 loginUniversalHttp 的 Claims (organizationId, eventId, userId)
    if (claims.organizationId && claims.eventId && claims.userId) {
      // 检查是否匹配当前上下文的组织和活动
      const isMatch = claims.organizationId === organizationId && claims.eventId === eventId;
      
      console.log('[AuthContext] 使用新版 Claims 检查权限:', {
        claimsOrg: claims.organizationId,
        claimsEvent: claims.eventId,
        contextOrg: organizationId,
        contextEvent: eventId,
        isMatch
      });

      if (isMatch) {
        return {
          userId: claims.userId,
          roles: claims.roles || [],
          needsFirestoreLoad: true
        };
      }
    }

    // 2. 兼容旧版 Claims (authUid, events)
    if (claims.authUid && claims.events) {
      const currentEventKey = `${orgCode}-${eventCode}`;
      const hasAccess = claims.events.includes(currentEventKey);

      console.log('[AuthContext] 使用旧版 Claims 检查权限:', {
        currentEventKey,
        userEvents: claims.events,
        hasAccess
      });

      if (hasAccess) {
        return {
          userId: claims.authUid,
          needsFirestoreLoad: true
        };
      }
    }

    console.log('[AuthContext] Claims 检查失败:', claims);
    return null;
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
    
    if (roles.includes('teamLeader')) {
      return `/team-leader/${orgEventCode}/dashboard`;
    }
    
    // ⭐⭐⭐ Cashier 导航 ⭐⭐⭐
    if (roles.includes('cashier')) {
      console.log('[AuthContext] ✅ 导航到 Cashier Dashboard');
      return `/cashier/${orgEventCode}/dashboard`;
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
    
    // ⭐ merchantOwner 和 merchantAsist 共用同一个 Dashboard
    if (roles.includes('merchantOwner') || roles.includes('merchantAsist')) {
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
      // ⭐ 關鍵：任何 Auth 狀態切換都先進入 loading，避免路由守衛在 profile 未就緒時誤判「權限不足」
      setLoading(true);

      // ✅ 检测是否在登录页面或密码设置页面（用于静默处理警告）
      const isLoginPage = window.location.pathname.includes('/login') || 
                          window.location.pathname.includes('/setup-passwords');
      
      console.log('[AuthContext] Auth state changed:', user ? user.uid : 'no user');
      
      if (user && !user.isAnonymous) {
        setCurrentUser(user);
        
        try {
          // 步骤 1: 获取 Custom Claims
          const idTokenResult = await user.getIdTokenResult();
          const c = idTokenResult?.claims || {};
          setClaims(c);
          console.log('[AuthContext] Loaded custom claims:', c);

          // 步驟 2: 檢查 Profile 是否完整
          // ✅ 增强检查：对于需要 identityTag 的角色，必须有 identityTag
          const hasBasicInfo = userProfile && userProfile.userId && userProfile.roles;
          
          // 🔧 关键修复：检查数据完整性
          const needsIdentityTag = userProfile?.roles?.some(role =>
            ['customer', 'merchantOwner', 'merchantAsist'].includes(role)
          );
          const hasIdentityTag = !!userProfile?.identityTag;
          
          // 如果需要 identityTag 但没有，强制重新加载
          if (hasBasicInfo && needsIdentityTag && !hasIdentityTag) {
            console.warn('[AuthContext] ⚠️ Profile 缺少 identityTag，强制从 Firestore 重新加载');
            console.warn('[AuthContext] 当前 roles:', userProfile.roles);
            console.warn('[AuthContext] identityTag:', userProfile.identityTag);
            // 不使用旧的 profile，强制重新加载
          } else if (hasBasicInfo) {
            console.log('[AuthContext] ✅ 使用已有的 userProfile');
            setLoading(false);
            return;
          }

          console.log('[AuthContext] 🔄 Profile 不存在，準備從 Firestore 載入...');

          // ✅ 步驟 3: 檢查用戶是否已登入（不論 Claims 內容）
          // 只要 Firebase Auth 有 user，我們就嘗試根據當前 URL 加載 Profile
          let profile = {
            authUid: user.uid,
            needsFirestoreLoad: true
          };

          // ✅ 步驟 4: 從 Firestore 加載完整用戶數據 (基於 URL 的 Context)
          if (profile.needsFirestoreLoad) {
            try {
              const loadedProfile = await loadUserProfile(user.uid);
              if (loadedProfile) {
                profile = loadedProfile;
              } else {
                console.warn('[AuthContext] ⚠️ 在當前活動中找不到該用戶的數據（Firestore 查詢返回空）');
                profile = null;
              }
            } catch (firestoreError) {
              console.warn('[AuthContext] ⚠️ Firestore 讀取失敗（可能是權限問題）:', firestoreError?.message);
              // 降級：嘗試從 localStorage 恢復
              console.log('[AuthContext] 📱 嘗試從 localStorage 恢復用戶資料...');
              const storedUser = localStorage.getItem('currentUser');
              if (storedUser) {
                try {
                  profile = JSON.parse(storedUser);
                  console.log('[AuthContext] ✅ 從 localStorage 恢復用戶資料成功');
                } catch (parseError) {
                  console.error('[AuthContext] localStorage 恢復失敗:', parseError);
                  profile = null;
                }
              } else {
                profile = null;
              }
            }
          }

          // ✅ 步驟 5: 如果在當前活動找不到數據，才考慮處理
          if (!profile) {
            if (!isLoginPage) {
              console.warn('[AuthContext] ⚠️ 用戶無權訪問此活動，但不強制登出以支持多分頁');
            }
            setUserProfile(null);
            setLoading(false);
            return;
          }

          // 步骤 6: 合併 Claims Roles (確保權限即時性)
          if (profile && c.roles && Array.isArray(c.roles)) {
            const currentRoles = Array.isArray(profile.roles) ? profile.roles : [];
            const combinedRoles = Array.from(new Set([
              ...currentRoles,
              ...c.roles
            ]));
            
            // 只有在不同時才更新，避免觸發不必要的渲染
            if (combinedRoles.length !== currentRoles.length) {
              console.log('[AuthContext] 🧬 合併 Claims Roles:', {
                firestore: currentRoles,
                claims: c.roles,
                merged: combinedRoles
              });
              profile.roles = combinedRoles;
            }
          }

          // 步骤 7: 规范化角色名称
          if (profile) {
            const normalized = normalizeProfile(profile);
            setUserProfile(normalized);
            console.log('[AuthContext] ✅ User profile 设置完成:', {
              userId: normalized.userId,
              roles: normalized.roles,
              organizationId: normalized.organizationId,
              eventId: normalized.eventId,
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
      ['merchantOwnerInfo', 'merchantAsistInfo', 'customerInfo', 'eventManagerInfo',
       'teamLeaderInfo', 'cashierInfo',
       // ⭐ 兼容旧版：同时清除旧的 merchantInfo
       'merchantInfo'].forEach(key => {
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
      'cashier',      // ⭐ Cashier
      'teamLeader',
      'merchantManager',
      'customerManager',
      'merchantOwner',  // ⭐ 修改：merchant → merchantOwner
      'merchantAsist',  // ⭐ 新增：merchantAsist
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

    setUserProfile((prev) => {
      // 角色规范化（兼容 event_manager）
      const normalizedRoles = Array.isArray(profile?.roles)
        ? profile.roles.map((r) => (r === 'event_manager' ? 'eventManager' : r))
        : prev?.roles;

      // 合并 identityInfo（避免被 undefined 覆盖）
      const mergedIdentityInfo = {
        ...(prev?.identityInfo || {}),
        ...(profile?.identityInfo || {})
      };

      // 合并 basicInfo（避免覆盖掉已存在字段）
      const mergedBasicInfo = {
        ...(prev?.basicInfo || {}),
        ...(profile?.basicInfo || {})
      };

      // 关键：保留既有 identityTag（避免 InitialPasswordSetup 之类的 payload 没带就把它洗掉）
      const resolvedIdentityTag =
        profile?.identityTag ||
        profile?.identityInfo?.identityTag ||
        prev?.identityTag ||
        prev?.identityInfo?.identityTag ||
        mergedIdentityInfo?.identityTag;

      const enrichedProfile = {
        ...(prev || {}),
        ...profile,
        roles: normalizedRoles || profile?.roles,
        basicInfo: mergedBasicInfo,
        identityInfo: Object.keys(mergedIdentityInfo).length ? mergedIdentityInfo : undefined,
        identityTag: resolvedIdentityTag,
        // ⭐ 确保包含 organizationCode 和 eventCode（用于导航）
        organizationCode:
          profile?.organizationCode || profile?.orgCode || prev?.organizationCode || orgCode,
        eventCode: profile?.eventCode || prev?.eventCode || eventCode
      };

      return enrichedProfile;
    });
  };

  const value = {
    currentUser,
    userProfile,
    claims,
    loading,
    error,
    login,
    logout,
    refreshProfile,
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
