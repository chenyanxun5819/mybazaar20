const admin = require('firebase-admin');
const serviceAccount = require('../key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkUser() {
  const orgId = 'mnkJd29mCvAG12a3KSRm';
  const eventId = 'jvd2eZqLWay5Pe8TGCGy';
  const userId = 'customer_1766709435828_1de5cb44';

  console.log(`Checking user ${userId} in org ${orgId}, event ${eventId}...`);

  const userDoc = await db.collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(userId)
    .get();

  if (userDoc.exists) {
    console.log('User document exists!');
    console.log('Data:', JSON.stringify(userDoc.data(), null, 2));
  } else {
    console.log('User document DOES NOT exist.');
  }

  // Also check for other events with code 2025
  console.log('\nChecking all events with code 2025...');
  const eventsSnap = await db.collection('organizations').doc(orgId)
    .collection('events').where('eventCode', '==', '2025').get();
  
  for (const doc of eventsSnap.docs) {
    console.log(`Event ID: ${doc.id}, Name: ${doc.data().eventName?.['zh-CN']}`);
    // Check if user exists in this event
    const uSnap = await db.collection('organizations').doc(orgId)
      .collection('events').doc(doc.id)
      .collection('users').doc(userId).get();
    if (uSnap.exists) {
       console.log(`  -> User ${userId} FOUND in this event.`);
    } else {
       console.log(`  -> User ${userId} NOT found in this event.`);
    }
  }
}

checkUser().catch(console.error);
