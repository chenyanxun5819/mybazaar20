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
    
    // bcrypt 的 hash 格式：$2a$10$saltsaltsalthashhashhashhash
    // 前面的部分就是 salt，但我们可以单独存储完整的 hash
    const salt = hash.substring(0, 29); // 提取 salt 部分（可选，主要用于记录）
    
    return {
      hash: hash,
      salt: salt // bcrypt 的 salt 已经包含在 hash 中了
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
