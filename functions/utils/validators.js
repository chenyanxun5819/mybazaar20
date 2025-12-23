/**
 * validators.js
 * 密码和 PIN 验证函数
 */

/**
 * 验证登录密码强度
 * @param {string} password - 密码
 * @returns {{isValid: boolean, error: string|null}}
 */
function validateLoginPassword(password) {
  if (!password) {
    return { isValid: false, error: '密码不能为空' };
  }

  if (password.length < 8) {
    return { isValid: false, error: '密码至少需要8个字符' };
  }

  if (password.length > 128) {
    return { isValid: false, error: '密码不能超过128个字符' };
  }

  // 必须包含字母
  if (!/[a-zA-Z]/.test(password)) {
    return { isValid: false, error: '密码必须包含字母' };
  }

  // 必须包含数字
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: '密码必须包含数字' };
  }

  return { isValid: true, error: null };
}

/**
 * 验证交易 PIN 格式
 * @param {string} pin - 交易 PIN
 * @returns {{isValid: boolean, error: string|null}}
 */
function validateTransactionPin(pin) {
  if (!pin) {
    return { isValid: false, error: '交易密码不能为空' };
  }

  // 必须是6位数字
  if (!/^\d{6}$/.test(pin)) {
    return { isValid: false, error: '交易密码必须是6位数字' };
  }

  // 检查是否是简单密码
  const weakPins = [
    '000000', '111111', '222222', '333333', '444444',
    '555555', '666666', '777777', '888888', '999999',
    '123456', '654321', '123123', '321321',
    '111222', '222333', '333444', '444555', '555666',
    '666777', '777888', '888999'
  ];

  if (weakPins.includes(pin)) {
    return { isValid: false, error: '请使用更安全的密码组合，不要使用简单密码' };
  }

  // 检查是否是连续数字
  const digits = pin.split('').map(Number);
  let isAscending = true;
  let isDescending = true;
  
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== digits[i - 1] + 1) {
      isAscending = false;
    }
    if (digits[i] !== digits[i - 1] - 1) {
      isDescending = false;
    }
  }

  if (isAscending || isDescending) {
    return { isValid: false, error: '请不要使用连续数字' };
  }

  return { isValid: true, error: null };
}

/**
 * 验证手机号格式（马来西亚）
 * @param {string} phoneNumber - 手机号
 * @returns {{isValid: boolean, error: string|null}}
 */
function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return { isValid: false, error: '手机号不能为空' };
  }

  // 马来西亚手机号：+60 开头，后面跟9-10位数字
  const phoneRegex = /^\+60\d{9,10}$/;
  
  if (!phoneRegex.test(phoneNumber)) {
    return { isValid: false, error: '手机号格式不正确，必须是 +60 开头的马来西亚手机号' };
  }

  return { isValid: true, error: null };
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱
 * @returns {{isValid: boolean, error: string|null}}
 */
function validateEmail(email) {
  if (!email) {
    return { isValid: true, error: null }; // 邮箱是可选的
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(email)) {
    return { isValid: false, error: '邮箱格式不正确' };
  }

  return { isValid: true, error: null };
}

module.exports = {
  validateLoginPassword,
  validateTransactionPin,
  validatePhoneNumber,
  validateEmail
};
