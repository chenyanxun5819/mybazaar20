import { 
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

/**
 * 處理付款（透過 Cloud Function）
 * @param {Object} paymentData - 付款資料
 * @param {string} paymentData.organizationId - 組織 ID
 * @param {string} paymentData.eventId - 活動 ID
 * @param {string} paymentData.merchantId - 商家 ID
 * @param {string} paymentData.customerId - 顧客 ID
 * @param {number} paymentData.amount - 金額
 * @returns {Promise<Object>} 交易結果
 */
export const processPayment = async (paymentData) => {
  try {
    const processPaymentFunc = httpsCallable(functions, 'processPayment');
    const result = await processPaymentFunc(paymentData);
    
    return result.data;
  } catch (error) {
    console.error('Error processing payment:', error);
    
    // 解析錯誤訊息
    let errorMessage = '付款失敗';
    
    if (error.code === 'functions/unauthenticated') {
      errorMessage = '請先登入';
    } else if (error.code === 'functions/permission-denied') {
      errorMessage = '權限不足';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * 取得交易記錄
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @param {Object} options - 查詢選項
 * @param {number} options.limit - 限制數量
 * @param {string} options.filterBy - 篩選條件 ('today' | 'week' | 'all')
 * @param {string} options.status - 狀態篩選
 * @returns {Promise<Array>} 交易記錄列表
 */
export const getTransactionHistory = async (orgId, eventId, merchantId, options = {}) => {
  try {
    const {
      limit: limitCount = 50,
      filterBy = 'all',
      status = null
    } = options;

    const transactionsRef = collection(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'transactions'
    );

    // 建立查詢條件
    let constraints = [
      where('merchantId', '==', merchantId),
      orderBy('timestamp', 'desc')
    ];

    // 時間篩選
    if (filterBy === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      constraints.push(where('timestamp', '>=', Timestamp.fromDate(todayStart)));
    } else if (filterBy === 'week') {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);
      constraints.push(where('timestamp', '>=', Timestamp.fromDate(weekStart)));
    }

    // 狀態篩選
    if (status) {
      constraints.push(where('status', '==', status));
    }

    // 限制數量
    if (limitCount) {
      constraints.push(limit(limitCount));
    }

    const q = query(transactionsRef, ...constraints);
    const querySnapshot = await getDocs(q);

    const transactions = [];
    querySnapshot.forEach(doc => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return transactions;
  } catch (error) {
    console.error('Error getting transaction history:', error);
    throw error;
  }
};

/**
 * 取得單筆交易詳情
 * @param {string} orgId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} transactionId - 交易 ID
 * @returns {Promise<Object>} 交易詳情
 */
export const getTransactionDetail = async (orgId, eventId, transactionId) => {
  try {
    const transactionRef = doc(
      db,
      'organizations',
      orgId,
      'events',
      eventId,
      'transactions',
      transactionId
    );

    const transactionSnap = await getDoc(transactionRef);

    if (!transactionSnap.exists()) {
      throw new Error('交易不存在');
    }

    return {
      id: transactionSnap.id,
      ...transactionSnap.data()
    };
  } catch (error) {
    console.error('Error getting transaction detail:', error);
    throw error;
  }
};

/**
 * 格式化電話號碼（脫敏顯示）
 * @param {string} phone - 電話號碼
 * @returns {string} 脫敏後的電話號碼
 */
export const maskPhoneNumber = (phone) => {
  if (!phone) return '****';
  
  // 保留前 4 碼和後 3 碼，中間用 * 代替
  // 例如：+60123456789 -> +601****789
  if (phone.length > 7) {
    const prefix = phone.substring(0, 4);
    const suffix = phone.substring(phone.length - 3);
    const masked = '*'.repeat(Math.max(phone.length - 7, 4));
    return `${prefix}${masked}${suffix}`;
  }
  
  return phone;
};

/**
 * 格式化交易金額
 * @param {number} amount - 金額
 * @returns {string} 格式化後的金額
 */
export const formatAmount = (amount) => {
  if (typeof amount !== 'number') return '0';
  return amount.toLocaleString('en-MY');
};

/**
 * 格式化交易時間
 * @param {Timestamp} timestamp - Firestore Timestamp
 * @returns {string} 格式化後的時間
 */
export const formatTransactionTime = (timestamp) => {
  if (!timestamp) return '-';
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // 1 分鐘內
  if (diffMins < 1) {
    return '剛剛';
  }
  
  // 1 小時內
  if (diffMins < 60) {
    return `${diffMins} 分鐘前`;
  }
  
  // 今天
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }
  
  // 昨天
  if (diffDays === 1) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })}`;
  }
  
  // 7 天內
  if (diffDays < 7) {
    return `${diffDays} 天前`;
  }
  
  // 其他
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * 取得交易狀態顯示文字
 * @param {string} status - 交易狀態
 * @returns {Object} 狀態顯示資訊
 */
export const getTransactionStatusDisplay = (status) => {
  const statusMap = {
    completed: {
      text: '完成',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      icon: 'CheckCircle2'
    },
    failed: {
      text: '失敗',
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      icon: 'XCircle'
    },
    pending: {
      text: '處理中',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      icon: 'Clock'
    },
    refunded: {
      text: '已退款',
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
      icon: 'RotateCcw'
    }
  };

  return statusMap[status] || statusMap.completed;
};

/**
 * 驗證付款金額
 * @param {number} amount - 金額
 * @param {number} customerBalance - 顧客餘額
 * @returns {Object} 驗證結果
 */
export const validatePaymentAmount = (amount, customerBalance) => {
  // 檢查金額是否有效
  if (!amount || amount <= 0) {
    return {
      isValid: false,
      error: '請輸入有效金額'
    };
  }

  // 檢查是否為整數
  if (!Number.isInteger(amount)) {
    return {
      isValid: false,
      error: '金額必須為整數'
    };
  }

  // 檢查餘額是否足夠
  if (amount > customerBalance) {
    return {
      isValid: false,
      error: `餘額不足（當前餘額：${formatAmount(customerBalance)} 點）`
    };
  }

  return {
    isValid: true,
    error: null
  };
};