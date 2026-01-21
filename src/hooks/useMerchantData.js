import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';;
import {
  getMerchantData,
  getMerchantByUserId,
  getMerchantStats,
  updateMerchantProfile,
  toggleMerchantStatus
} from '../services/merchantService';

/**
 * Custom hook 用於管理 merchant 資料
 * @param {string} userId - 用戶 ID
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @returns {Object} Merchant 資料和操作函數
 */
export const useMerchantData = (userId, orgId, eventId) => {
  const [merchant, setMerchant] = useState(null);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    transactionCount: 0,
    todayRevenue: 0,
    todayTransactionCount: 0,
    isActive: true
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 初始載入 merchant 資料
  useEffect(() => {
    if (!userId || !orgId || !eventId) {
      setLoading(false);
      return;
    }

    let unsubscribe = null;

    const loadMerchant = async () => {
      try {
        setLoading(true);
        setError(null);

        // 根據 userId 取得 merchant
        const merchantData = await getMerchantByUserId(orgId, eventId, userId);

        if (!merchantData) {
          // ⭐ 区分"未分配摊位"和"真正的错误"
          setMerchant(null);
          setError(null);  // 不设置错误，这是正常状态
          setLoading(false);
          return;
        }

        setMerchant(merchantData);

        // 設置實時監聽
        const merchantRef = doc(
          db,
          'organizations',
          orgId,
          'events',
          eventId,
          'merchants',
          merchantData.id
        );

        unsubscribe = onSnapshot(
          merchantRef,
          (snapshot) => {
            if (snapshot.exists()) {
              setMerchant({
                id: snapshot.id,
                ...snapshot.data()
              });
            }
          },
          (err) => {
            console.error('Error listening to merchant updates:', err);
          }
        );

        setLoading(false);
      } catch (err) {
        console.error('Error loading merchant:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    loadMerchant();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [userId, orgId, eventId]);

  // 載入統計資料
  const refreshStats = useCallback(async () => {
    if (!merchant?.id || !orgId || !eventId) return;

    try {
      const statsData = await getMerchantStats(orgId, eventId, merchant.id);
      setStats(statsData);
    } catch (err) {
      console.error('Error refreshing stats:', err);
    }
  }, [merchant?.id, orgId, eventId]);

  // 初始載入統計並設置定期刷新
  useEffect(() => {
    if (!merchant?.id) return;

    refreshStats();

    // 每 30 秒刷新一次統計
    const interval = setInterval(refreshStats, 30000);

    return () => clearInterval(interval);
  }, [merchant?.id, refreshStats]);

  // 更新商家資料
  const updateProfile = useCallback(async (data) => {
    if (!merchant?.id || !orgId || !eventId) {
      throw new Error('缺少必要資訊');
    }

    try {
      await updateMerchantProfile(orgId, eventId, merchant.id, data);
      // Firestore listener 會自動更新 state
      return { success: true };
    } catch (err) {
      console.error('Error updating profile:', err);
      throw err;
    }
  }, [merchant?.id, orgId, eventId]);

  // 切換營業狀態
  const toggleStatus = useCallback(async (isActive) => {
    if (!merchant?.id || !orgId || !eventId) {
      throw new Error('缺少必要資訊');
    }

    try {
      await toggleMerchantStatus(orgId, eventId, merchant.id, isActive);
      return { success: true };
    } catch (err) {
      console.error('Error toggling status:', err);
      throw err;
    }
  }, [merchant?.id, orgId, eventId]);

  return {
    merchant,
    stats,
    loading,
    error,
    refreshStats,
    updateProfile,
    toggleStatus
  };
};

/**
 * Custom hook 用於監聽交易更新
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {Object} 最新交易和統計
 */
export const useTransactionUpdates = (orgId, eventId, merchantId) => {
  const [latestTransaction, setLatestTransaction] = useState(null);
  const [transactionCount, setTransactionCount] = useState(0);

  useEffect(() => {
    if (!orgId || !eventId || !merchantId) return;

    // 監聽交易記錄（這裡可以用 query + onSnapshot）
    // 為了簡化，暫時先不實作實時監聽所有交易
    // 可以在後續 Phase 加入

    // TODO: 實作交易實時監聽

  }, [orgId, eventId, merchantId]);

  return {
    latestTransaction,
    transactionCount
  };
};

export default useMerchantData;

