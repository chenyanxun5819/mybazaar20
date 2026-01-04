// customClaimsHelper.js
// 统一的 Custom Claims 管理辅助函数
// 用于支持多事件的 Custom Claims 架构

const admin = require('firebase-admin');

/**
 * 更新用户的 Custom Claims，支持多事件
 * 
 * @param {string} authUid - Firebase Auth UID (如 phone_60123456789)
 * @param {string} orgCode - 组织代码 (如 xhessbn)
 * @param {string} eventCode - 活动代码 (如 2026)
 * @param {string} action - 'add' 或 'remove'
 * @returns {Promise<void>}
 */
async function updateUserCustomClaims(authUid, orgCode, eventCode, action = 'add') {
  try {
    console.log(`[updateUserCustomClaims] 开始更新 Custom Claims:`, {
      authUid,
      orgCode,
      eventCode,
      action
    });

    // 获取当前用户的 Claims
    let currentClaims = {};
    try {
      const user = await admin.auth().getUser(authUid);
      currentClaims = user.customClaims || {};
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.warn(`[updateUserCustomClaims] Auth 用户不存在: ${authUid}`);
        return;
      }
      throw error;
    }

    // 获取现有事件列表
    let events = currentClaims.events || [];
    const eventKey = `${orgCode}-${eventCode}`;

    console.log(`[updateUserCustomClaims] 当前事件列表:`, events);
    console.log(`[updateUserCustomClaims] 操作事件 key:`, eventKey);

    // 根据 action 更新事件列表
    if (action === 'add') {
      if (!events.includes(eventKey)) {
        events.push(eventKey);
        console.log(`[updateUserCustomClaims] ✅ 添加事件: ${eventKey}`);
      } else {
        console.log(`[updateUserCustomClaims] ℹ️ 事件已存在: ${eventKey}`);
      }
    } else if (action === 'remove') {
      const beforeLength = events.length;
      events = events.filter(e => e !== eventKey);
      if (events.length < beforeLength) {
        console.log(`[updateUserCustomClaims] ✅ 移除事件: ${eventKey}`);
      } else {
        console.log(`[updateUserCustomClaims] ℹ️ 事件不存在: ${eventKey}`);
      }
    }

    // 更新 Claims
    const newClaims = {
      authUid: authUid,
      events: events
    };

    await admin.auth().setCustomUserClaims(authUid, newClaims);
    
    console.log(`[updateUserCustomClaims] ✅ Claims 更新成功:`, {
      authUid,
      eventsCount: events.length,
      events: events
    });

  } catch (error) {
    console.error('[updateUserCustomClaims] ❌ 更新失败:', {
      authUid,
      orgCode,
      eventCode,
      error: error.message
    });
    // 不抛出错误，避免阻止用户创建
    // 用户仍然可以通过 Firestore 数据正常使用系统
  }
}

/**
 * 获取用户的所有事件列表
 * 
 * @param {string} authUid - Firebase Auth UID
 * @returns {Promise<string[]>} 事件列表 (如 ['xhessbn-2026', 'chhxsban-2026'])
 */
async function getUserEvents(authUid) {
  try {
    const user = await admin.auth().getUser(authUid);
    const claims = user.customClaims || {};
    return claims.events || [];
  } catch (error) {
    console.error('[getUserEvents] Error:', error);
    return [];
  }
}

/**
 * 检查用户是否参与某个事件
 * 
 * @param {string} authUid - Firebase Auth UID
 * @param {string} orgCode - 组织代码
 * @param {string} eventCode - 活动代码
 * @returns {Promise<boolean>}
 */
async function userHasEvent(authUid, orgCode, eventCode) {
  const events = await getUserEvents(authUid);
  const eventKey = `${orgCode}-${eventCode}`;
  return events.includes(eventKey);
}

module.exports = {
  updateUserCustomClaims,
  getUserEvents,
  userHasEvent
};