/*
Run this script from your functions directory (where firebase-admin is configured).
It will find all user docs under organizations/{org}/events/{event}/users where roles array contains
'event_manager' and replace that entry with 'eventManager'.

Usage (from c:\mybazaar20\functions):
  node migrations/migrateEventManagerRole.js

Be careful: this performs writes to your production Firestore. Test on a staging project first.
*/

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function migrateBatch() {
  console.log('Starting migration: replace event_manager -> eventManager');

  // Query all organization docs
  const orgsSnap = await db.collection('organizations').get();
  console.log(`Found ${orgsSnap.size} organizations`);

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    const eventsSnap = await db.collection('organizations').doc(orgId).collection('events').get();
    console.log(`- Org ${orgId}: ${eventsSnap.size} events`);

    for (const eventDoc of eventsSnap.docs) {
      const eventId = eventDoc.id;
      const usersRef = db.collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      // Query users that have legacy role
      const q = usersRef.where('roles', 'array-contains', 'event_manager');
      const snap = await q.get();
      if (snap.empty) continue;

      console.log(`  - Event ${eventId}: ${snap.size} users to update`);

      // Process in batches of 500
      let batch = db.batch();
      let ops = 0;
      for (const doc of snap.docs) {
        const data = doc.data();
        const roles = Array.isArray(data.roles) ? data.roles.slice() : [];
        const newRoles = roles.map(r => r === 'event_manager' ? 'eventManager' : r);
        batch.update(doc.ref, { roles: newRoles });
        ops++;

        if (ops >= 450) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
          console.log('    committed a batch of updates');
        }
      }

      if (ops > 0) {
        await batch.commit();
        console.log('    committed final batch');
      }
    }
  }

  console.log('Migration complete');
}

migrateBatch().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
