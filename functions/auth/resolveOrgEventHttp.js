const functions = require('firebase-functions');
const admin = require('firebase-admin');

/**
 * 解析 orgCode + eventCode => Firestore IDs
 *
 * @route POST /api/resolveOrgEventHttp
 * @body { orgCode: string, eventCode: string }
 * @returns { success: true, organizationId, eventId }
 */
exports.resolveOrgEventHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: '仅支持 POST 请求' } });
  }

  const { orgCode, eventCode } = req.body || {};
  const orgCodeRaw = String(orgCode || '').trim();
  const orgCodeLower = orgCodeRaw.toLowerCase();
  const eventCodeStr = String(eventCode || '').trim();

  if (!orgCodeLower || !eventCodeStr) {
    return res.status(400).json({
      error: { message: '请提供 orgCode 与 eventCode' }
    });
  }

  try {
    const db = admin.firestore();

    const orgSnapshot = await db
      .collection('organizations')
      .where('orgCode', '==', orgCodeLower)
      .limit(1)
      .get();

    if (orgSnapshot.empty) {
      // 向后兼容：若传入的是组织/活动 Firestore 文档 ID（orgId-eventId），直接按 docId 验证
      const orgByIdSnap = await db.collection('organizations').doc(orgCodeRaw).get();
      if (orgByIdSnap.exists) {
        const evtByIdSnap = await db
          .collection('organizations')
          .doc(orgCodeRaw)
          .collection('events')
          .doc(eventCodeStr)
          .get();

        if (evtByIdSnap.exists) {
          return res.status(200).json({
            success: true,
            organizationId: orgCodeRaw,
            eventId: eventCodeStr
          });
        }

        return res.status(404).json({
          error: { message: `找不到活动代码: ${eventCodeStr}` }
        });
      }

      return res.status(404).json({
        error: { message: `找不到组织代码: ${orgCodeLower}` }
      });
    }

    const orgDoc = orgSnapshot.docs[0];
    const organizationId = orgDoc.id;

    const eventSnapshot = await db
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .where('eventCode', '==', eventCodeStr)
      .limit(1)
      .get();

    if (eventSnapshot.empty) {
      // 向后兼容：允许 eventCodeStr 其实是 eventId
      const evtByIdSnap = await db
        .collection('organizations')
        .doc(organizationId)
        .collection('events')
        .doc(eventCodeStr)
        .get();

      if (evtByIdSnap.exists) {
        return res.status(200).json({
          success: true,
          organizationId,
          eventId: eventCodeStr
        });
      }

      return res.status(404).json({
        error: { message: `找不到活动代码: ${eventCodeStr}` }
      });
    }

    const eventDoc = eventSnapshot.docs[0];
    const eventId = eventDoc.id;

    return res.status(200).json({
      success: true,
      organizationId,
      eventId
    });
  } catch (err) {
    console.error('[resolveOrgEventHttp] 错误:', err);
    return res.status(500).json({
      error: { message: err?.message || '服务器错误' }
    });
  }
});
