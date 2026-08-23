import { loadEnv } from '../env.js';

loadEnv();

let rtdbUrl = null;
let databaseSecret = null;
let initialized = false;

const TIMEOUT_MS = 8000;

export function initFirebase() {
  if (initialized) return { url: rtdbUrl, secret: databaseSecret };

  loadEnv();

  const rawUrl = process.env.FIREBASE_DATABASE_URL ? process.env.FIREBASE_DATABASE_URL.trim() : '';
  const rawSecret = process.env.FIREBASE_DATABASE_SECRET ? process.env.FIREBASE_DATABASE_SECRET.trim() : '';

  if (!rawUrl) {
    throw new Error('[Firebase RTDB] Missing required environment variable: FIREBASE_DATABASE_URL. Please define it in your .env file.');
  }

  if (!rawSecret) {
    throw new Error('[Firebase RTDB] Missing required environment variable: FIREBASE_DATABASE_SECRET. Please define it in your .env file.');
  }

  rtdbUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  databaseSecret = rawSecret;
  initialized = true;

  console.log(`[Firebase RTDB] Connected via URL: ${rtdbUrl} (Secret: Configured)`);
  return { url: rtdbUrl, secret: databaseSecret };
}

export function getDatabaseConfig() {
  if (!initialized) {
    return initFirebase();
  }
  return {
    url: rtdbUrl,
    secret: databaseSecret
  };
}

async function restFetch(path, options = {}) {
  const { url, secret } = getDatabaseConfig();
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  let target = `${url}/${cleanPath}.json`;
  if (secret) {
    target += `?auth=${encodeURIComponent(secret)}`;
  }

  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options
    });
    clearTimeout(tm);

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Firebase RTDB error (${res.status}): ${errorText || res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(tm);
    const sanitized = (err.message || 'Firebase request failed').replace(/auth=[^&]+/, 'auth=***');
    throw new Error(sanitized);
  }
}

export async function getPath(path) {
  try {
    const data = await restFetch(path, { method: 'GET' });
    return data;
  } catch (err) {
    console.warn(`[Firebase RTDB] Read ${path} failed:`, err.message);
    return null;
  }
}

export async function setPath(path, value) {
  try {
    await restFetch(path, {
      method: 'PUT',
      body: JSON.stringify(value)
    });
    return value;
  } catch (err) {
    console.warn(`[Firebase RTDB] Write ${path} failed:`, err.message);
    throw err;
  }
}

export async function updatePath(path, updates) {
  try {
    await restFetch(path, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    return updates;
  } catch (err) {
    console.warn(`[Firebase RTDB] Update ${path} failed:`, err.message);
    throw err;
  }
}

export async function deletePath(path) {
  try {
    await restFetch(path, { method: 'DELETE' });
    return true;
  } catch (err) {
    console.warn(`[Firebase RTDB] Delete ${path} failed:`, err.message);
    return false;
  }
}

export function encodeKey(str) {
  return String(str)
    .replace(/\./g, '%2E')
    .replace(/\$/g, '%24')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/#/g, '%23')
    .replace(/\//g, '%2F');
}

export function decodeKey(str) {
  return decodeURIComponent(str);
}

// -------------------------------------------------------------
// USER & PROFILE OPERATIONS
// -------------------------------------------------------------

export async function getProfile(userId) {
  if (!userId) return null;
  const profile = await getPath(`profiles/${userId}`);
  return profile || null;
}

export async function createProfile(userId, profileData) {
  if (!userId) throw new Error('userId is required');
  const record = {
    id: userId,
    name: profileData.name || 'Athlete',
    created: profileData.created || new Date().toISOString(),
    admin: !!profileData.admin,
    disabled: !!profileData.disabled,
    invitedBy: profileData.invitedBy || null,
    lastReminder: profileData.lastReminder || null,
    sv: profileData.sv || 0
  };
  await setPath(`profiles/${userId}`, record);
  return record;
}

export async function updateProfile(userId, updates) {
  if (!userId) throw new Error('userId is required');
  await updatePath(`profiles/${userId}`, updates);
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
  await Promise.all([
    deletePath(`profiles/${userId}`),
    deletePath(`users/${userId}`),
    deletePath(`subscriptions/${userId}`)
  ]);
}

export async function listUsers() {
  const data = await getPath('profiles');
  if (!data) return [];
  return Object.values(data);
}

// -------------------------------------------------------------
// PASSKEY OPERATIONS
// -------------------------------------------------------------

export async function addPasskey(userId, passkeyData) {
  if (!userId || !passkeyData?.id) throw new Error('userId and passkey.id are required');
  const safeId = encodeKey(passkeyData.id);
  const credRecord = {
    id: passkeyData.id,
    userId,
    publicKey: passkeyData.publicKey,
    counter: passkeyData.counter || 0,
    transports: passkeyData.transports || [],
    created: new Date().toISOString()
  };
  await setPath(`profiles/${userId}/publicPasskeys/${safeId}`, credRecord);
  return credRecord;
}

export async function getPasskeys(userId) {
  if (!userId) return [];
  const keysObj = await getPath(`profiles/${userId}/publicPasskeys`);
  if (!keysObj) return [];
  return Object.values(keysObj);
}

export async function findPasskey(credId) {
  if (!credId) return null;
  const users = await listUsers();
  for (const u of users) {
    if (u.publicPasskeys) {
      for (const cred of Object.values(u.publicPasskeys)) {
        if (cred && cred.id === credId) {
          return { cred, user: u };
        }
      }
    }
  }
  return null;
}

export async function updatePasskeyCounter(userId, credId, newCounter) {
  if (!userId || !credId) return;
  const safeId = encodeKey(credId);
  await updatePath(`profiles/${userId}/publicPasskeys/${safeId}`, { counter: newCounter });
}

// -------------------------------------------------------------
// USER GYM STATE
// -------------------------------------------------------------

export async function getUserState(userId) {
  if (!userId) return null;
  const data = await getPath(`users/${userId}`);
  return data || null;
}

export async function saveUserState(userId, state) {
  if (!userId) throw new Error('userId required');
  const cleanState = { ...state };
  delete cleanState.active;
  cleanState._ts = cleanState._ts || Date.now();
  await setPath(`users/${userId}`, cleanState);
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
  const updates = {};
  if (planData.routines !== undefined) updates.routines = planData.routines;
  if (planData.week !== undefined) updates.week = planData.week;
  if (planData.dayPlan !== undefined) updates.dayPlan = planData.dayPlan;
  if (planData.customEx !== undefined) updates.customEx = planData.customEx;
  updates._ts = Date.now();
  await updatePath(`users/${userId}`, updates);
  return await getPlan(userId);
}

export async function getWorkouts(userId) {
  const state = await getUserState(userId);
  return state?.workouts || [];
}

export async function saveWorkout(userId, workout) {
  if (!userId || !workout) throw new Error('userId and workout are required');
  const workouts = await getWorkouts(userId);
  workouts.push(workout);
  await updatePath(`users/${userId}`, { workouts, _ts: Date.now() });
  return workouts;
}

export async function deleteWorkout(userId, workoutIdentifier) {
  if (!userId) throw new Error('userId required');
  let workouts = await getWorkouts(userId);
  if (typeof workoutIdentifier === 'number') {
    workouts.splice(workoutIdentifier, 1);
  } else {
    workouts = workouts.filter(w => (w.id || w.d) !== workoutIdentifier);
  }
  await updatePath(`users/${userId}`, { workouts, _ts: Date.now() });
  return workouts;
}

export async function getBodyWeight(userId) {
  const state = await getUserState(userId);
  return state?.bodyweight || [];
}

export async function saveBodyWeight(userId, bwEntry) {
  if (!userId || !bwEntry) throw new Error('userId and bwEntry are required');
  const bodyweight = await getBodyWeight(userId);
  bodyweight.push(bwEntry);
  await updatePath(`users/${userId}`, { bodyweight, _ts: Date.now() });
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
  const updates = { ...settingsData, _ts: Date.now() };
  await updatePath(`users/${userId}`, updates);
  return await getSettings(userId);
}

// -------------------------------------------------------------
// INVITES OPERATIONS
// -------------------------------------------------------------

export async function listInvites() {
  const data = await getPath('invites');
  if (!data) return [];
  return Object.values(data);
}

export async function getInvite(code) {
  if (!code) return null;
  const safeCode = encodeKey(code.toUpperCase());
  return await getPath(`invites/${safeCode}`);
}

export async function saveInvite(invite) {
  if (!invite?.code) throw new Error('invite code required');
  const safeCode = encodeKey(invite.code.toUpperCase());
  await setPath(`invites/${safeCode}`, invite);
  return invite;
}

export async function revokeInvite(code) {
  if (!code) return false;
  const safeCode = encodeKey(code.toUpperCase());
  await deletePath(`invites/${safeCode}`);
  return true;
}

// -------------------------------------------------------------
// PUSH SUBSCRIPTIONS OPERATIONS
// -------------------------------------------------------------

export async function getPushSubscriptions(userId) {
  if (!userId) return [];
  const subs = await getPath(`subscriptions/${userId}`);
  if (!subs) return [];
  return Object.values(subs);
}

export async function listAllPushSubscriptions() {
  const allSubs = await getPath('subscriptions');
  if (!allSubs) return [];
  const list = [];
  for (const [userId, userSubs] of Object.entries(allSubs)) {
    if (userSubs && typeof userSubs === 'object') {
      for (const sub of Object.values(userSubs)) {
        if (sub) list.push({ ...sub, userId });
      }
    }
  }
  return list;
}

export async function savePushSubscription(userId, sub) {
  if (!userId || !sub?.endpoint) return;
  const safeId = encodeKey(sub.endpoint.slice(-40));
  const record = {
    userId,
    endpoint: sub.endpoint,
    keys: sub.keys,
    created: new Date().toISOString()
  };
  await setPath(`subscriptions/${userId}/${safeId}`, record);
  return record;
}

export async function removePushSubscription(userId, endpoint) {
  if (!userId || !endpoint) return;
  const safeId = encodeKey(endpoint.slice(-40));
  await deletePath(`subscriptions/${userId}/${safeId}`);
}

export async function removePushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) return;
  const safeId = encodeKey(endpoint.slice(-40));
  const allSubs = await getPath('subscriptions');
  if (!allSubs) return;
  for (const userId of Object.keys(allSubs)) {
    if (allSubs[userId]?.[safeId]) {
      await deletePath(`subscriptions/${userId}/${safeId}`);
    }
  }
}

// -------------------------------------------------------------
// SYSTEM CONFIGURATION
// -------------------------------------------------------------

export async function getSystemData(key) {
  return await getPath(`system/${key}`);
}

export async function saveSystemData(key, value) {
  await setPath(`system/${key}`, value);
  return value;
}
