import { loadEnv } from '../env.js';

loadEnv();

let pool = null;
let initialized = false;

export async function initMySQL() {
  if (initialized && pool) return pool;

  loadEnv();

  const host = process.env.MYSQL_HOST ? process.env.MYSQL_HOST.trim() : '';
  const user = process.env.MYSQL_USER ? process.env.MYSQL_USER.trim() : '';
  const password = process.env.MYSQL_PASSWORD !== undefined ? String(process.env.MYSQL_PASSWORD) : '';
  const database = process.env.MYSQL_DATABASE ? process.env.MYSQL_DATABASE.trim() : '';
  const port = +(process.env.MYSQL_PORT || 3306);

  if (!host) {
    throw new Error('[MySQL] Missing required environment variable: MYSQL_HOST. Please define it in your .env file.');
  }
  if (!user) {
    throw new Error('[MySQL] Missing required environment variable: MYSQL_USER. Please define it in your .env file.');
  }
  if (!database) {
    throw new Error('[MySQL] Missing required environment variable: MYSQL_DATABASE. Please define it in your .env file.');
  }

  const mysql = await import('mysql2/promise');

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  });

  // Test connection and auto-migrate tables
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_profiles (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created VARCHAR(64),
        admin TINYINT(1) DEFAULT 0,
        disabled TINYINT(1) DEFAULT 0,
        invitedBy VARCHAR(255) DEFAULT NULL,
        lastReminder VARCHAR(64) DEFAULT NULL,
        sv INT DEFAULT 0,
        data JSON DEFAULT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_passkeys (
        id VARCHAR(255) PRIMARY KEY,
        userId VARCHAR(255) NOT NULL,
        publicKey TEXT NOT NULL,
        counter BIGINT DEFAULT 0,
        transports JSON DEFAULT NULL,
        created VARCHAR(64),
        INDEX idx_userId (userId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_user_states (
        userId VARCHAR(255) PRIMARY KEY,
        data JSON NOT NULL,
        updated_at BIGINT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_invites (
        code VARCHAR(255) PRIMARY KEY,
        note TEXT,
        createdBy VARCHAR(255),
        created VARCHAR(64),
        usedBy VARCHAR(255) DEFAULT NULL,
        usedAt VARCHAR(64) DEFAULT NULL,
        data JSON DEFAULT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_subscriptions (
        id VARCHAR(255) PRIMARY KEY,
        userId VARCHAR(255) NOT NULL,
        endpoint TEXT NOT NULL,
        data JSON NOT NULL,
        created VARCHAR(64),
        INDEX idx_sub_userId (userId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS opengym_system (
        config_key VARCHAR(255) PRIMARY KEY,
        value JSON NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } finally {
    conn.release();
  }

  initialized = true;
  console.log(`[MySQL] Connected successfully to ${user}@${host}:${port}/${database}`);
  return pool;
}

async function getPool() {
  if (!initialized || !pool) {
    await initMySQL();
  }
  return pool;
}

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

// -------------------------------------------------------------
// USER & PROFILE OPERATIONS
// -------------------------------------------------------------

export async function getProfile(userId) {
  if (!userId) return null;
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_profiles WHERE id = ?', [userId]);
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const publicPasskeys = {};
  const [keyRows] = await p.query('SELECT * FROM opengym_passkeys WHERE userId = ?', [userId]);
  for (const k of keyRows) {
    publicPasskeys[k.id] = {
      id: k.id,
      userId: k.userId,
      publicKey: k.publicKey,
      counter: Number(k.counter || 0),
      transports: parseJson(k.transports) || [],
      created: k.created
    };
  }

  return {
    id: row.id,
    name: row.name,
    created: row.created,
    admin: !!row.admin,
    disabled: !!row.disabled,
    invitedBy: row.invitedBy || null,
    lastReminder: row.lastReminder || null,
    sv: row.sv || 0,
    publicPasskeys,
    ...(parseJson(row.data) || {})
  };
}

export async function createProfile(userId, profileData) {
  if (!userId) throw new Error('userId is required');
  const p = await getPool();
  const record = {
    id: userId,
    name: profileData.name || 'Athlete',
    created: profileData.created || new Date().toISOString(),
    admin: profileData.admin ? 1 : 0,
    disabled: profileData.disabled ? 1 : 0,
    invitedBy: profileData.invitedBy || null,
    lastReminder: profileData.lastReminder || null,
    sv: profileData.sv || 0
  };

  await p.query(
    `INSERT INTO opengym_profiles (id, name, created, admin, disabled, invitedBy, lastReminder, sv, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), admin=VALUES(admin), disabled=VALUES(disabled), invitedBy=VALUES(invitedBy), lastReminder=VALUES(lastReminder), sv=VALUES(sv)`,
    [record.id, record.name, record.created, record.admin, record.disabled, record.invitedBy, record.lastReminder, record.sv, JSON.stringify(profileData)]
  );

  return await getProfile(userId);
}

export async function updateProfile(userId, updates) {
  if (!userId) throw new Error('userId is required');
  const current = await getProfile(userId);
  if (!current) return null;
  const merged = { ...current, ...updates };

  const p = await getPool();
  await p.query(
    `UPDATE opengym_profiles SET name=?, admin=?, disabled=?, invitedBy=?, lastReminder=?, sv=?, data=? WHERE id=?`,
    [
      merged.name || 'Athlete',
      merged.admin ? 1 : 0,
      merged.disabled ? 1 : 0,
      merged.invitedBy || null,
      merged.lastReminder || null,
      merged.sv || 0,
      JSON.stringify(merged),
      userId
    ]
  );
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
  const p = await getPool();
  await Promise.all([
    p.query('DELETE FROM opengym_profiles WHERE id = ?', [userId]),
    p.query('DELETE FROM opengym_passkeys WHERE userId = ?', [userId]),
    p.query('DELETE FROM opengym_user_states WHERE userId = ?', [userId]),
    p.query('DELETE FROM opengym_subscriptions WHERE userId = ?', [userId])
  ]);
}

export async function listUsers() {
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_profiles');
  const list = [];
  for (const r of rows) {
    const user = await getProfile(r.id);
    if (user) list.push(user);
  }
  return list;
}

// -------------------------------------------------------------
// PASSKEY OPERATIONS
// -------------------------------------------------------------

export async function addPasskey(userId, passkeyData) {
  if (!userId || !passkeyData?.id) throw new Error('userId and passkey.id are required');
  const p = await getPool();
  const credRecord = {
    id: passkeyData.id,
    userId,
    publicKey: passkeyData.publicKey,
    counter: passkeyData.counter || 0,
    transports: passkeyData.transports || [],
    created: new Date().toISOString()
  };

  await p.query(
    `INSERT INTO opengym_passkeys (id, userId, publicKey, counter, transports, created)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE publicKey=VALUES(publicKey), counter=VALUES(counter), transports=VALUES(transports)`,
    [credRecord.id, userId, credRecord.publicKey, credRecord.counter, JSON.stringify(credRecord.transports), credRecord.created]
  );
  return credRecord;
}

export async function getPasskeys(userId) {
  if (!userId) return [];
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_passkeys WHERE userId = ?', [userId]);
  return rows.map(k => ({
    id: k.id,
    userId: k.userId,
    publicKey: k.publicKey,
    counter: Number(k.counter || 0),
    transports: parseJson(k.transports) || [],
    created: k.created
  }));
}

export async function findPasskey(credId) {
  if (!credId) return null;
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_passkeys WHERE id = ?', [credId]);
  if (!rows || rows.length === 0) return null;
  const k = rows[0];
  const user = await getProfile(k.userId);
  if (!user) return null;
  const cred = {
    id: k.id,
    userId: k.userId,
    publicKey: k.publicKey,
    counter: Number(k.counter || 0),
    transports: parseJson(k.transports) || [],
    created: k.created
  };
  return { cred, user };
}

export async function updatePasskeyCounter(userId, credId, newCounter) {
  if (!credId) return;
  const p = await getPool();
  await p.query('UPDATE opengym_passkeys SET counter = ? WHERE id = ?', [newCounter, credId]);
}

// -------------------------------------------------------------
// USER GYM STATE
// -------------------------------------------------------------

export async function getUserState(userId) {
  if (!userId) return null;
  const p = await getPool();
  const [rows] = await p.query('SELECT data FROM opengym_user_states WHERE userId = ?', [userId]);
  if (!rows || rows.length === 0) return null;
  return parseJson(rows[0].data);
}

export async function saveUserState(userId, state) {
  if (!userId) throw new Error('userId required');
  const cleanState = { ...state };
  delete cleanState.active;
  cleanState._ts = cleanState._ts || Date.now();

  const p = await getPool();
  await p.query(
    `INSERT INTO opengym_user_states (userId, data, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)`,
    [userId, JSON.stringify(cleanState), cleanState._ts]
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
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_invites');
  return rows.map(r => ({
    code: r.code,
    note: r.note,
    createdBy: r.createdBy,
    created: r.created,
    usedBy: r.usedBy || null,
    usedAt: r.usedAt || null,
    ...(parseJson(r.data) || {})
  }));
}

export async function getInvite(code) {
  if (!code) return null;
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_invites WHERE code = ?', [code.toUpperCase()]);
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    code: r.code,
    note: r.note,
    createdBy: r.createdBy,
    created: r.created,
    usedBy: r.usedBy || null,
    usedAt: r.usedAt || null,
    ...(parseJson(r.data) || {})
  };
}

export async function saveInvite(invite) {
  if (!invite?.code) throw new Error('invite code required');
  const p = await getPool();
  const code = invite.code.toUpperCase();
  await p.query(
    `INSERT INTO opengym_invites (code, note, createdBy, created, usedBy, usedAt, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE note=VALUES(note), createdBy=VALUES(createdBy), created=VALUES(created), usedBy=VALUES(usedBy), usedAt=VALUES(usedAt), data=VALUES(data)`,
    [code, invite.note || '', invite.createdBy || 'admin', invite.created || new Date().toISOString(), invite.usedBy || null, invite.usedAt || null, JSON.stringify(invite)]
  );
  return invite;
}

export async function revokeInvite(code) {
  if (!code) return false;
  const p = await getPool();
  const [res] = await p.query('DELETE FROM opengym_invites WHERE code = ?', [code.toUpperCase()]);
  return res.affectedRows > 0;
}

// -------------------------------------------------------------
// PUSH SUBSCRIPTIONS OPERATIONS
// -------------------------------------------------------------

export async function getPushSubscriptions(userId) {
  if (!userId) return [];
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_subscriptions WHERE userId = ?', [userId]);
  return rows.map(r => parseJson(r.data)).filter(Boolean);
}

export async function listAllPushSubscriptions() {
  const p = await getPool();
  const [rows] = await p.query('SELECT * FROM opengym_subscriptions');
  return rows.map(r => parseJson(r.data)).filter(Boolean);
}

export async function savePushSubscription(userId, sub) {
  if (!userId || !sub?.endpoint) return;
  const p = await getPool();
  const safeId = sub.endpoint.slice(-40);
  const record = {
    userId,
    endpoint: sub.endpoint,
    keys: sub.keys,
    created: new Date().toISOString()
  };

  await p.query(
    `INSERT INTO opengym_subscriptions (id, userId, endpoint, data, created)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data=VALUES(data)`,
    [safeId, userId, sub.endpoint, JSON.stringify(record), record.created]
  );
  return record;
}

export async function removePushSubscription(userId, endpoint) {
  if (!userId || !endpoint) return;
  const p = await getPool();
  const safeId = endpoint.slice(-40);
  await p.query('DELETE FROM opengym_subscriptions WHERE id = ? AND userId = ?', [safeId, userId]);
}

export async function removePushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) return;
  const p = await getPool();
  const safeId = endpoint.slice(-40);
  await p.query('DELETE FROM opengym_subscriptions WHERE id = ?', [safeId]);
}

// -------------------------------------------------------------
// SYSTEM CONFIGURATION
// -------------------------------------------------------------

export async function getSystemData(key) {
  if (!key) return null;
  const p = await getPool();
  const [rows] = await p.query('SELECT value FROM opengym_system WHERE config_key = ?', [key]);
  if (!rows || rows.length === 0) return null;
  return parseJson(rows[0].value);
}

export async function saveSystemData(key, value) {
  if (!key) return;
  const p = await getPool();
  await p.query(
    `INSERT INTO opengym_system (config_key, value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value=VALUES(value)`,
    [key, JSON.stringify(value)]
  );
  return value;
}
