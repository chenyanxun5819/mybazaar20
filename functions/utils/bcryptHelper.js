/**
 * bcryptHelper.js
 * bcrypt 密码加密和验证辅助函数
 */

const bcrypt = require('bcryptjs');

// bcrypt 成本因子（10-12 是推荐值，越高越安全但越慢）
const SALT_ROUNDS = 10;

/**
 * 加密密码
 * @param {string} plainPassword - 明文密码
 * @returns {Promise<{hash: string, salt: string}>} - 返回哈希值和盐值
 */
async function hashPassword(plainPassword) {
  try {
    // bcrypt 会自动生成 salt 并包含在 hash 中
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    
    // ✅ 修复：bcrypt 的 salt 已经完全包含在 hash 中，不需要单独存储
    // 返回空字符串作为 salt，表示使用 bcrypt 格式（新格式）
    // 验证时检测：如果 salt 为空或不存在，就用 bcrypt；否则用 SHA256（旧格式）
    
    return {
      hash: hash,
      salt: "" // ✅ 明确表示这是 bcrypt 新格式，salt 不需要单独存储
    };
  } catch (error) {
    console.error('[bcryptHelper] 加密密码失败:', error);
    throw new Error('密码加密失败');
  }
}

/**
 * 验证密码
 * @param {string} plainPassword - 明文密码
 * @param {string} hashedPassword - 哈希密码
 * @returns {Promise<boolean>} - 密码是否匹配
 */
async function verifyPassword(plainPassword, hashedPassword) {
  try {
    const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
    return isMatch;
  } catch (error) {
    console.error('[bcryptHelper] 验证密码失败:', error);
    throw new Error('密码验证失败');
  }
}

/**
 * 加密交易 PIN（6位数字）
 * @param {string} plainPin - 明文 PIN（6位数字）
 * @returns {Promise<{hash: string, salt: string}>}
 */
async function hashPin(plainPin) {
  // PIN 加密方式与密码相同
  return hashPassword(plainPin);
}

/**
 * 验证交易 PIN
 * @param {string} plainPin - 明文 PIN
 * @param {string} hashedPin - 哈希 PIN
 * @returns {Promise<boolean>}
 */
async function verifyPin(plainPin, hashedPin) {
  return verifyPassword(plainPin, hashedPin);
}

module.exports = {
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  SALT_ROUNDS
};
