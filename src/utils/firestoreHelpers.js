/**
 * Firestore 助手函數 - 確保所有 Firestore 操作都有正確的錯誤處理和初始化檢查
 */

import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  where, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc 
} from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * 驗證 Firestore 是否正確初始化
 */
export const validateFirestore = () => {
  if (!db) {
    throw new Error('Firestore database not initialized');
  }
  if (typeof collection !== 'function') {
    throw new Error('collection function not available');
  }
  if (typeof getDocs !== 'function') {
    throw new Error('getDocs function not available');
  }
  if (typeof doc !== 'function') {
    throw new Error('doc function not available');
  }
  if (typeof getDoc !== 'function') {
    throw new Error('getDoc function not available');
  }
  return true;
};

/**
 * 安全地獲取集合引用
 */
export const getSafeCollectionRef = (...paths) => {
  validateFirestore();
  return collection(db, ...paths);
};

/**
 * 安全地獲取文件引用
 */
export const getSafeDocRef = (...paths) => {
  validateFirestore();
  return doc(db, ...paths);
};

/**
 * 安全地查詢集合中的所有文件
 */
export const fetchCollectionDocs = async (...paths) => {
  validateFirestore();
  const ref = collection(db, ...paths);
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

/**
 * 安全地查詢帶排序的集合
 */
export const fetchCollectionWithOrder = async (orderConfig, ...paths) => {
  validateFirestore();
  const ref = collection(db, ...paths);
  const q = query(ref, orderBy(orderConfig.field, orderConfig.direction || 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

/**
 * 安全地獲取單個文件
 */
export const fetchDoc = async (...paths) => {
  validateFirestore();
  const ref = doc(db, ...paths);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return {
      id: snapshot.id,
      ...snapshot.data()
    };
  }
  return null;
};

/**
 * 安全地設置文件
 */
export const setDocData = async (data, ...paths) => {
  validateFirestore();
  const ref = doc(db, ...paths);
  await setDoc(ref, data);
  return ref;
};

/**
 * 安全地更新文件
 */
export const updateDocData = async (data, ...paths) => {
  validateFirestore();
  const ref = doc(db, ...paths);
  await updateDoc(ref, data);
  return ref;
};

/**
 * 安全地刪除文件
 */
export const deleteDocData = async (...paths) => {
  validateFirestore();
  const ref = doc(db, ...paths);
  await deleteDoc(ref);
};

export default {
  validateFirestore,
  getSafeCollectionRef,
  getSafeDocRef,
  fetchCollectionDocs,
  fetchCollectionWithOrder,
  fetchDoc,
  setDocData,
  updateDocData,
  deleteDocData
};

