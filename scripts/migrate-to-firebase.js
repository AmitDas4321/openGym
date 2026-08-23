#!/usr/bin/env node
import { loadEnv } from '../database/env.js';
loadEnv();

import fs from 'node:fs';
import path from 'node:path';
import {
  createProfile,
  addPasskey,
  saveUserState,
  saveInvite,
  savePushSubscription,
  saveSystemData,
  getProfile,
  getUserState
} from '../database/index.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const force = process.argv.includes('--force');

async function migrate() {
  console.log('====================================================');
  console.log(' openGym -> Firebase Realtime Database Migration');
  console.log('====================================================');
  console.log(`Source directory: ${DATA_DIR}`);
  console.log(`Force overwrite : ${force ? 'YES' : 'NO (safe mode)'}`);
  console.log('');

  if (!fs.existsSync(DATA_DIR)) {
    console.log('No local data directory found. Nothing to migrate.');
    return;
  }

  const dbFile = path.join(DATA_DIR, 'db.json');
  let db = { users: [], creds: [], subs: [], invites: [] };
  if (fs.existsSync(dbFile)) {
    try {
      db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      console.log(`Found db.json: ${db.users?.length || 0} user(s), ${db.creds?.length || 0} cred(s), ${db.invites?.length || 0} invite(s)`);
    } catch (e) {
      console.error('Error reading db.json:', e.message);
    }
  }

  // 1. Migrate Users & Profiles
  const userList = db.users || [];
  let userCount = 0;
  for (const u of userList) {
    const existing = await getProfile(u.id);
    if (existing && !force) {
      console.log(`- Skipping existing user: ${u.name} (${u.id})`);
    } else {
      await createProfile(u.id, {
        name: u.name,
        created: u.created || new Date().toISOString(),
        admin: !!u.admin,
        disabled: !!u.disabled,
        invitedBy: u.invitedBy || null,
        lastReminder: u.lastReminder || null,
        sv: u.sv || 0
      });
      console.log(`+ Migrated user: ${u.name} (${u.id})`);
      userCount++;
    }
  }

  // 2. Migrate Passkeys
  const credList = db.creds || [];
  let credCount = 0;
  for (const c of credList) {
    try {
      await addPasskey(c.userId, {
        id: c.id,
        publicKey: c.publicKey,
        counter: c.counter || 0,
        transports: c.transports || []
      });
      credCount++;
    } catch (e) {
      console.error(`! Error migrating passkey ${c.id}:`, e.message);
    }
  }
  console.log(`+ Migrated ${credCount} public passkey credential(s)`);

  // 3. Migrate Invites
  const inviteList = db.invites || [];
  let inviteCount = 0;
  for (const inv of inviteList) {
    try {
      await saveInvite(inv);
      inviteCount++;
    } catch (e) {
      console.error(`! Error migrating invite ${inv.code}:`, e.message);
    }
  }
  if (inviteCount > 0) console.log(`+ Migrated ${inviteCount} invite(s)`);

  // 4. Migrate Push Subscriptions
  const subList = db.subs || [];
  let subCount = 0;
  for (const s of subList) {
    try {
      await savePushSubscription(s.userId, s);
      subCount++;
    } catch (e) {
      console.error(`! Error migrating subscription:`, e.message);
    }
  }
  if (subCount > 0) console.log(`+ Migrated ${subCount} push subscription(s)`);

  // 5. Migrate VAPID keys if any
  const vapidFile = path.join(DATA_DIR, 'vapid.json');
  if (fs.existsSync(vapidFile)) {
    try {
      const vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
      await saveSystemData('vapid', vapid);
      console.log('+ Migrated VAPID keys to Firebase');
    } catch (e) {
      console.error('! Error migrating vapid.json:', e.message);
    }
  }

  // 6. Migrate per-user state files (state-<uid>.json)
  const files = fs.readdirSync(DATA_DIR);
  let stateCount = 0;
  for (const f of files) {
    if (f.startsWith('state-') && f.endsWith('.json')) {
      const uid = f.slice(6, -5);
      const filePath = path.join(DATA_DIR, f);
      try {
        const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const existingState = await getUserState(uid);
        if (existingState && !force) {
          console.log(`- Skipping existing state for user ${uid}`);
        } else {
          await saveUserState(uid, state);
          console.log(`+ Migrated gym state for user ${uid} (${(state.workouts || []).length} workouts, ${(state.routines || []).length} routines)`);
          stateCount++;
        }
      } catch (e) {
        console.error(`! Error migrating state file ${f}:`, e.message);
      }
    }
  }

  console.log('');
  console.log('====================================================');
  console.log(' Migration complete!');
  console.log(` Users: ${userCount}, Passkeys: ${credCount}, States: ${stateCount}`);
  console.log('====================================================');
}

migrate().catch(err => {
  console.error('Migration failed fatal error:', err);
  process.exit(1);
});
