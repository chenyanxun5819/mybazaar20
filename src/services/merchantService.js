import { 
  doc, 
  getDoc, 
  updateDoc, 
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  increment
} from 'firebase/firestore';
import { db } from '../config/firebase';;

/**
 * 取得商家資料
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {Promise<Object>} 商家資料
 */
export const getMerchantData = async (orgId, eventId, merchantId) => {
  try {
    const merchantRef = doc(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'merchants',
      merchantId
    );

    const merchantSnap = await getDoc(merchantRef);

    if (!merchantSnap.exists()) {
      throw new Error('商家不存在');
    }

    return {
      id: merchantSnap.id,
      ...merchantSnap.data()
    };
  } catch (error) {
    console.error('Error getting merchant data:', error);
    throw error;
  }
};

/**
 * 根據 userId 取得商家資料
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} userId - 用戶 ID
 * @returns {Promise<Object|null>} 商家資料
 */
export const getMerchantByUserId = async (orgId, eventId, userId) => {
  try {
    const merchantsRef = collection(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'merchants'
    );

    // 優先：以新架構欄位查找（merchantOwnerId / merchantAsists）
    // 後備：相容舊欄位 userId
    const queries = [
      query(merchantsRef, where('merchantOwnerId', '==', userId)),
      query(merchantsRef, where('merchantAsists', 'array-contains', userId)),
      query(merchantsRef, where('userId', '==', userId))
    ];

    for (const q of queries) {
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        // 理論上一個 user 只能對應一個 merchant
        const merchantDoc = querySnapshot.docs[0];
        return {
          id: merchantDoc.id,
          ...merchantDoc.data()
        };
      }
    }

    return null;
  } catch (error) {
    const isPermissionDenied =
      error?.code === 'permission-denied' ||
      error?.code === 'firestore/permission-denied' ||
      /insufficient permissions/i.test(error?.message || '');

    if (!isPermissionDenied) {
      console.error('Error getting merchant by userId:', error);
    }

    throw error;
  }
};

/**
 * 更新商家基本資料
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @param {Object} data - 要更新的資料
 * @returns {Promise<void>}
 */
export const updateMerchantProfile = async (orgId, eventId, merchantId, data) => {
  try {
    const merchantRef = doc(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'merchants',
      merchantId
    );

    // 只允許更新特定欄位
    const allowedFields = ['stallName', 'description', 'contactInfo', 'isActive'];
    const updateData = {};

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    });

    updateData.updatedAt = serverTimestamp();

    await updateDoc(merchantRef, updateData);
  } catch (error) {
    console.error('Error updating merchant profile:', error);
    throw error;
  }
};

/**
 * 取得商家統計資料
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {Promise<Object>} 統計資料
 */
export const getMerchantStats = async (orgId, eventId, merchantId) => {
  try {
    const merchantData = await getMerchantData(orgId, eventId, merchantId);

    const revenueStats = merchantData.revenueStats || {};
    const dailyRevenue = merchantData.dailyRevenue || {};

    return {
      // revenueStats 欄位（對應 Firestore schema revenueStats.*）
      totalRevenue: revenueStats.totalRevenue || 0,
      transactionCount: revenueStats.transactionCount || 0,
      ownerCollectedRevenue: revenueStats.ownerCollectedRevenue || 0,
      asistsCollectedRevenue: revenueStats.asistsCollectedRevenue || 0,
      // dailyRevenue 欄位（對應 Firestore schema dailyRevenue.*）
      todayRevenue: dailyRevenue.today || 0,
      todayTransactionCount: dailyRevenue.todayTransactionCount || 0,
      isActive: merchantData.isActive !== false // 預設為 true
    };
  } catch (error) {
    console.error('Error getting merchant stats:', error);
    throw error;
  }
};

/**
 * 更新商家收入（由 Cloud Function 調用）
 * 這個函數主要是給前端參考，實際應該在 Cloud Function 中執行
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @param {number} amount - 交易金額
 * @returns {Promise<void>}
 */
export const updateMerchantRevenue = async (orgId, eventId, merchantId, amount) => {
  try {
    const merchantRef = doc(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'merchants',
      merchantId
    );

    await updateDoc(merchantRef, {
      totalRevenue: increment(amount),
      transactionCount: increment(1),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating merchant revenue:', error);
    throw error;
  }
};

/**
 * 切換商家營業狀態
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @param {boolean} isActive - 營業狀態
 * @returns {Promise<void>}
 */
export const toggleMerchantStatus = async (orgId, eventId, merchantId, isActive) => {
  try {
    const merchantRef = doc(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'merchants',
      merchantId
    );

    await updateDoc(merchantRef, {
      isActive,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error toggling merchant status:', error);
    throw error;
  }
};

/**
 * 生成商家 QR Code 資料
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {Object} QR Code 資料
 */
export const generateMerchantQRData = (orgId, eventId, merchantId) => {
  return {
    type: 'MERCHANT_PAYMENT',
    organizationId: orgId,
    eventId: eventId,
    merchantId: merchantId,
    timestamp: new Date().toISOString()
  };
};

