import { loadEnv } from '../env.js';

loadEnv();

let client = null;
let db = null;
let initialized = false;

export async function initMongoDB() {
  if (initialized && db) return db;

  loadEnv();

  const uri = process.env.MONGODB_URI ? process.env.MONGODB_URI.trim() : '';
  const dbName = (process.env.MONGODB_DATABASE || 'openGym').trim();

  if (!uri) {
    throw new Error('[MongoDB] Missing required environment variable: MONGODB_URI. Please define it in your .env file.');
  }

  const { MongoClient } = await import('mongodb');

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000
  });

  await client.connect();
  db = client.db(dbName);

  // Initialize indexes
  try {
    await db.collection('passkeys').createIndex({ userId: 1 });
    await db.collection('subscriptions').createIndex({ userId: 1 });
  } catch (err) {
    console.warn('[MongoDB] Index creation notice:', err.message);
  }

  initialized = true;
  console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
  return db;
}

async function getDb() {
  if (!initialized || !db) {
    await initMongoDB();
  }
  return db;
}

// -------------------------------------------------------------
// USER & PROFILE OPERATIONS
// -------------------------------------------------------------

export async function getProfile(userId) {
  if (!userId) return null;
  const d = await getDb();
  const doc = await d.collection('profiles').findOne({ _id: userId });
  if (!doc) return null;

  const keyDocs = await d.collection('passkeys').find({ userId }).toArray();
  const publicPasskeys = {};
  for (const k of keyDocs) {
    publicPasskeys[k.id || k._id] = {
      id: k.id || k._id,
      userId: k.userId,
      publicKey: k.publicKey,
      counter: k.counter || 0,
      transports: k.transports || [],
      created: k.created
    };
  }

  return {
    id: doc.id || doc._id,
    name: doc.name || 'Athlete',
    created: doc.created,
    admin: !!doc.admin,
    disabled: !!doc.disabled,
    invitedBy: doc.invitedBy || null,
    lastReminder: doc.lastReminder || null,
    sv: doc.sv || 0,
    publicPasskeys,
    ...(doc.data || {})
  };
}

export async function createProfile(userId, profileData) {
  if (!userId) throw new Error('userId is required');
  const d = await getDb();
  const record = {
    _id: userId,
    id: userId,
    name: profileData.name || 'Athlete',
    created: profileData.created || new Date().toISOString(),
    admin: !!profileData.admin,
    disabled: !!profileData.disabled,
    invitedBy: profileData.invitedBy || null,
    lastReminder: profileData.lastReminder || null,
    sv: profileData.sv || 0,
    data: profileData
  };

  await d.collection('profiles').updateOne(
    { _id: userId },
    { $set: record },
    { upsert: true }
  );

  return await getProfile(userId);
}

export async function updateProfile(userId, updates) {
  if (!userId) throw new Error('userId is required');
  const d = await getDb();
  const current = await getProfile(userId);
  if (!current) return null;

  const setObj = {};
  if (updates.name !== undefined) setObj.name = updates.name;
  if (updates.admin !== undefined) setObj.admin = !!updates.admin;
  if (updates.disabled !== undefined) setObj.disabled = !!updates.disabled;
  if (updates.invitedBy !== undefined) setObj.invitedBy = updates.invitedBy;
  if (updates.lastReminder !== undefined) setObj.lastReminder = updates.lastReminder;
  if (updates.sv !== undefined) setObj.sv = updates.sv;
  setObj.data = { ...(current.data || current), ...updates };

  await d.collection('profiles').updateOne({ _id: userId }, { $set: setObj });
  return await getProfile(userId);
}

export async function getUser(userId) {
  return await getProfile(userId);
}

export async function createUser(userData) {
  const userId = userData.id || userData.uid;
  return await createProfile(userId, userData);
}

export async function updateUser(userId, data) {
  return await updateProfile(userId, data);
}

export async function deleteUser(userId) {
  if (!userId) return;
  const d = await getDb();
  await Promise.all([
    d.collection('profiles').deleteOne({ _id: userId }),
    d.collection('passkeys').deleteMany({ userId }),
    d.collection('user_states').deleteOne({ _id: userId }),
    d.collection('subscriptions').deleteMany({ userId })
  ]);
}

export async function listUsers() {
  const d = await getDb();
  const docs = await d.collection('profiles').find({}).toArray();
  const list = [];
  for (const doc of docs) {
    const user = await getProfile(doc._id);
    if (user) list.push(user);
  }
  return list;
}

// -------------------------------------------------------------
// PASSKEY OPERATIONS
// -------------------------------------------------------------

export async function addPasskey(userId, passkeyData) {
  if (!userId || !passkeyData?.id) throw new Error('userId and passkey.id are required');
  const d = await getDb();
  const credRecord = {
    _id: passkeyData.id,
    id: passkeyData.id,
    userId,
    publicKey: passkeyData.publicKey,
    counter: passkeyData.counter || 0,
    transports: passkeyData.transports || [],
    created: new Date().toISOString()
  };

  await d.collection('passkeys').updateOne(
    { _id: passkeyData.id },
    { $set: credRecord },
    { upsert: true }
  );
  return credRecord;
}

export async function getPasskeys(userId) {
  if (!userId) return [];
  const d = await getDb();
  const docs = await d.collection('passkeys').find({ userId }).toArray();
  return docs.map(k => ({
    id: k.id || k._id,
    userId: k.userId,
    publicKey: k.publicKey,
    counter: k.counter || 0,
    transports: k.transports || [],
    created: k.created
  }));
}

export async function findPasskey(credId) {
  if (!credId) return null;
  const d = await getDb();
  const cred = await d.collection('passkeys').findOne({ _id: credId });
  if (!cred) return null;
  const user = await getProfile(cred.userId);
  if (!user) return null;
  return {
    cred: {
      id: cred.id || cred._id,
      userId: cred.userId,
      publicKey: cred.publicKey,
      counter: cred.counter || 0,
      transports: cred.transports || [],
      created: cred.created
    },
    user
  };
}

export async function updatePasskeyCounter(userId, credId, newCounter) {
  if (!credId) return;
  const d = await getDb();
  await d.collection('passkeys').updateOne({ _id: credId }, { $set: { counter: newCounter } });
}

// -------------------------------------------------------------
// USER GYM STATE
// -------------------------------------------------------------

export async function getUserState(userId) {
  if (!userId) return null;
  const d = await getDb();
  const doc = await d.collection('user_states').findOne({ _id: userId });
  return doc?.state || null;
}

export async function saveUserState(userId, state) {
  if (!userId) throw new Error('userId required');
  const cleanState = { ...state };
  delete cleanState.active;
  cleanState._ts = cleanState._ts || Date.now();

  const d = await getDb();
  await d.collection('user_states').updateOne(
    { _id: userId },
    { $set: { state: cleanState, updated_at: cleanState._ts } },
    { upsert: true }
  );
  return cleanState;
}

export async function getPlan(userId) {
  const state = await getUserState(userId);
  if (!state) return null;
  return {
    routines: state.routines || [],
    week: state.week || {},
    dayPlan: state.dayPlan || {},
    customEx: state.customEx || []
  };
}

export async function updatePlan(userId, planData) {
  if (!userId) throw new Error('userId required');
  const current = (await getUserState(userId)) || {};
  const updates = { ...current };
  if (planData.routines !== undefined) updates.routines = planData.routines;
  if (planData.week !== undefined) updates.week = planData.week;
  if (planData.dayPlan !== undefined) updates.dayPlan = planData.dayPlan;
  if (planData.customEx !== undefined) updates.customEx = planData.customEx;
  await saveUserState(userId, updates);
  return await getPlan(userId);
}

export async function getWorkouts(userId) {
  const state = await getUserState(userId);
  return state?.workouts || [];
}

export async function saveWorkout(userId, workout) {
  if (!userId || !workout) throw new Error('userId and workout are required');
  const state = (await getUserState(userId)) || {};
  const workouts = state.workouts || [];
  workouts.push(workout);
  state.workouts = workouts;
  await saveUserState(userId, state);
  return workouts;
}

export async function deleteWorkout(userId, workoutIdentifier) {
  if (!userId) throw new Error('userId required');
  const state = (await getUserState(userId)) || {};
  let workouts = state.workouts || [];
  if (typeof workoutIdentifier === 'number') {
    workouts.splice(workoutIdentifier, 1);
  } else {
    workouts = workouts.filter(w => (w.id || w.d) !== workoutIdentifier);
  }
  state.workouts = workouts;
  await saveUserState(userId, state);
  return workouts;
}

export async function getBodyWeight(userId) {
  const state = await getUserState(userId);
  return state?.bodyweight || [];
}

export async function saveBodyWeight(userId, bwEntry) {
  if (!userId || !bwEntry) throw new Error('userId and bwEntry are required');
  const state = (await getUserState(userId)) || {};
  const bodyweight = state.bodyweight || [];
  bodyweight.push(bwEntry);
  state.bodyweight = bodyweight;
  await saveUserState(userId, state);
  return bodyweight;
}

export async function getSettings(userId) {
  const state = await getUserState(userId);
  if (!state) return null;
  return {
    unit: state.unit || 'kg',
    restSec: state.restSec || 90,
    sound: state.sound ?? true,
    keepAwake: state.keepAwake ?? true,
    lang: state.lang || 'en',
    theme: state.theme || 'dark',
    accent: state.accent || 'lime',
    body: state.body || 'male',
    targetW: state.targetW || null,
    gifSize: state.gifSize || 'full',
    reminder: state.reminder || { on: false, time: '08:00', tz: null },
    effort: state.effort || null,
    exWeights: state.exWeights || {}
  };
}

export async function updateSettings(userId, settingsData) {
  if (!userId) throw new Error('userId required');
  const state = (await getUserState(userId)) || {};
  Object.assign(state, settingsData);
  await saveUserState(userId, state);
  return await getSettings(userId);
}

// -------------------------------------------------------------
// INVITES OPERATIONS
// -------------------------------------------------------------

export async function listInvites() {
  const d = await getDb();
  const docs = await d.collection('invites').find({}).toArray();
  return docs.map(doc => ({
    code: doc.code || doc._id,
    note: doc.note || '',
    createdBy: doc.createdBy || 'admin',
    created: doc.created,
    usedBy: doc.usedBy || null,
    usedAt: doc.usedAt || null
  }));
}

export async function getInvite(code) {
  if (!code) return null;
  const d = await getDb();
  const doc = await d.collection('invites').findOne({ _id: code.toUpperCase() });
  if (!doc) return null;
  return {
    code: doc.code || doc._id,
    note: doc.note || '',
    createdBy: doc.createdBy || 'admin',
    created: doc.created,
    usedBy: doc.usedBy || null,
    usedAt: doc.usedAt || null
  };
}

export async function saveInvite(invite) {
  if (!invite?.code) throw new Error('invite code required');
  const d = await getDb();
  const code = invite.code.toUpperCase();
  const doc = {
    _id: code,
    code,
    note: invite.note || '',
    createdBy: invite.createdBy || 'admin',
    created: invite.created || new Date().toISOString(),
    usedBy: invite.usedBy || null,
    usedAt: invite.usedAt || null
  };
  await d.collection('invites').updateOne({ _id: code }, { $set: doc }, { upsert: true });
  return invite;
}

export async function revokeInvite(code) {
  if (!code) return false;
  const d = await getDb();
  const res = await d.collection('invites').deleteOne({ _id: code.toUpperCase() });
  return res.deletedCount > 0;
}

// -------------------------------------------------------------
// PUSH SUBSCRIPTIONS OPERATIONS
// -------------------------------------------------------------

export async function getPushSubscriptions(userId) {
  if (!userId) return [];
  const d = await getDb();
  const docs = await d.collection('subscriptions').find({ userId }).toArray();
  return docs.map(doc => doc.sub || doc);
}

export async function listAllPushSubscriptions() {
  const d = await getDb();
  const docs = await d.collection('subscriptions').find({}).toArray();
  return docs.map(doc => doc.sub || doc);
}

export async function savePushSubscription(userId, sub) {
  if (!userId || !sub?.endpoint) return;
  const d = await getDb();
  const safeId = sub.endpoint.slice(-40);
  const record = {
    _id: safeId,
    userId,
    endpoint: sub.endpoint,
    keys: sub.keys,
    sub,
    created: new Date().toISOString()
  };
  await d.collection('subscriptions').updateOne({ _id: safeId }, { $set: record }, { upsert: true });
  return record;
}

export async function removePushSubscription(userId, endpoint) {
  if (!userId || !endpoint) return;
  const d = await getDb();
  const safeId = endpoint.slice(-40);
  await d.collection('subscriptions').deleteOne({ _id: safeId, userId });
}

export async function removePushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) return;
  const d = await getDb();
  const safeId = endpoint.slice(-40);
  await d.collection('subscriptions').deleteOne({ _id: safeId });
}

// -------------------------------------------------------------
// SYSTEM CONFIGURATION
// -------------------------------------------------------------

export async function getSystemData(key) {
  if (!key) return null;
  const d = await getDb();
  const doc = await d.collection('system').findOne({ _id: key });
  return doc?.value || null;
}

export async function saveSystemData(key, value) {
  if (!key) return;
  const d = await getDb();
  await d.collection('system').updateOne(
    { _id: key },
    { $set: { _id: key, key, value } },
    { upsert: true }
  );
  return value;
}
