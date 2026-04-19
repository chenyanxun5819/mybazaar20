/**
 * Transaction Utilities - 交易列表通用格式化函数
 * 
 * 使用场景：SellerTransactions, PointSellerTransactions 等列表显示
 * 
 * @version 1.0
 * @date 2026-04-19
 */

/**
 * 格式化客户显示名称 (含末四碼) - SellerTransactions 版本
 * 格式：Name(末四碼：6885)
 * 
 * @param {Object} tx - 交易对象
 * @param {Object} tx.customerBasicInfo - 客户基本信息
 * @param {string} tx.customerBasicInfo.englishName - 英文名称
 * @param {string} tx.customerBasicInfo.phoneNumber - 电话号码
 * @param {string} [tx.customerName] - 备用名称
 * @returns {string} 格式化后的客户名称
 * 
 * @example
 * formatCustomerDisplayName(tx)
 * // Returns: "Kathleen Ng(末四碼：6885)"
 */
export function formatCustomerDisplayName(tx) {
  const englishName = tx.customerBasicInfo?.englishName?.trim();
  const phoneLastFour = tx.customerBasicInfo?.phoneNumber?.slice(-4);

  if (englishName && phoneLastFour) {
    return `${englishName}(末四碼：${phoneLastFour})`;
  }

  if (englishName) {
    return englishName;
  }

  return tx.customerName || '未知';
}

/**
 * 格式化客户显示名称 (含末四碼) - MerchantTransactions 版本
 * 适用于使用 customerEnglishName/customerName + customerPhone 的数据
 * 格式：Name(末四碼：6885)
 * 
 * @param {Object} record - 交易记录对象
 * @param {string} [record.customerEnglishName] - 客户英文名
 * @param {string} [record.customerName] - 客户名称
 * @param {string} record.customerPhone - 客户电话号码
 * @returns {string} 格式化后的客户名称
 * 
 * @example
 * formatMerchantCustomerDisplay(payment)
 * // Returns: "Kathleen Ng(末四碼：6885)"
 */
export function formatMerchantCustomerDisplay(record) {
  const englishName = record.customerEnglishName?.trim() || record.customerName?.trim();
  const phoneLastFour = record.customerPhone?.slice(-4);

  if (englishName && phoneLastFour) {
    return `${englishName}(末四碼：${phoneLastFour})`;
  }

  if (englishName) {
    return englishName;
  }

  return '顾客';
}

/**
 * 格式化客户显示名称 (含末四碼) - PointSellerTransactions 版本
 * 适用于不同的数据结构（customerEnglishName, customerPhone）
 * 格式：Name(末四碼：6885)
 * 
 * @param {Object} record - 交易记录对象
 * @param {string} record.customerEnglishName - 客户英文名
 * @param {string} record.customerPhone - 客户电话号码
 * @param {string} [record.customerName] - 备用客户名
 * @returns {string} 格式化后的客户名称
 * 
 * @example
 * formatPointSellerCustomerDisplay(record)
 * // Returns: "Kathleen Ng(末四碼：6885)"
 */
export function formatPointSellerCustomerDisplay(record) {
  const englishName = record.customerEnglishName?.trim();
  const phoneLastFour = record.customerPhone?.slice(-4);

  if (englishName && phoneLastFour) {
    return `${englishName}(末四碼：${phoneLastFour})`;
  }

  if (englishName) {
    return englishName;
  }

  return record.customerName || '未知';
}

/**
 * 短日期格式 (dd MM, hh:mm)，月份用英文缩写
 * 格式：17 Apr, 14:30
 * 
 * @param {*} timestamp - Firestore Timestamp 或 Date 对象
 * @returns {string} 格式化后的日期时间
 * 
 * @example
 * formatShortDateTime(timestamp)
 * // Returns: "17 Apr, 14:30"
 */
export function formatShortDateTime(timestamp) {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hours}:${minutes}`;
}

/**
 * 交易列表通用的内联样式对象
 * 用于统一卡片列表布局
 * 
 * @returns {Object} 样式对象
 */
export const transactionListStyles = {
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0'
  },
  recordCard: {
    background: 'transparent',
    padding: '0.5rem 0.75rem',
    marginBottom: '0.25rem',
    borderBottom: '1px solid #e5e7eb'
  },
  // 第一行：短日期 + 交易序号
  recordCardFirstRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.5rem'
  },
  recordCardDate: {
    fontSize: '0.8rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  recordCardTransId: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  // 第二行：内容区域
  recordCardSecondRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem'
  },
  recordCardLeftInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem'
  },
  recordCardName: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardPhone: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  recordCardCardLabel: {
    flex: 1,
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardQuantity: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#3b82f6',
    whiteSpace: 'nowrap'
  }
};
