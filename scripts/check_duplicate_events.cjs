const admin = require('firebase-admin');
const serviceAccount = require('../key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkEvents() {
  const orgId = 'mnkJd29mCvAG12a3KSRm'; // chhsban
  const eventCode = '2025';

  console.log(`Checking events for org ${orgId} with code ${eventCode}...`);

  const snapshot = await db.collection('organizations').doc(orgId).collection('events')
    .where('eventCode', '==', eventCode)
    .get();

  if (snapshot.empty) {
    console.log('No events found.');
    return;
  }

  console.log(`Found ${snapshot.size} events:`);
  snapshot.forEach(doc => {
    console.log(`- ID: ${doc.id}, Name: ${doc.data().eventName?.['zh-CN'] || 'N/A'}`);
  });
}

checkEvents().catch(console.error);
