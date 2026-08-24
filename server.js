/* opengym — unified single server + Vite frontend + passkey (WebAuthn) auth + Firebase Realtime Database storage */
import { loadEnv } from './database/env.js';
loadEnv();

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import * as db from './database/index.js';

const PORT = +(process.env.PORT || 3000);
const RP_NAME = process.env.RP_NAME || 'openGym';
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;

// Session Secret from environment (never stored in local files or exposed to browser)
const SECRET = process.env.SESSION_SECRET || process.env.FIREBASE_DATABASE_SECRET || 'opengym-session-fallback-secret-key-2026';

function getReqRpId(req) {
  if (process.env.RP_ID) return process.env.RP_ID;
  const rawHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return rawHost.split(':')[0];
}

function getReqOrigins(req) {
  const origins = new Set();
  if (process.env.ORIGIN) origins.add(process.env.ORIGIN);

  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  origins.add(`${proto}://${host}`);

  if (req.headers.origin) origins.add(req.headers.origin);
  if (req.headers.referer) {
    try {
      const u = new URL(req.headers.referer);
      origins.add(u.origin);
    } catch {}
  }
  origins.add(`http://localhost:${PORT}`);
  origins.add(`http://127.0.0.1:${PORT}`);
  origins.add(`https://localhost:${PORT}`);
  return Array.from(origins);
}

const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));

/* ---------- push notifications (Web Push / VAPID) ---------- */
let vapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || ''
};

async function initVapid() {
  if (!vapid.publicKey || !vapid.privateKey) {
    try {
      const savedVapid = await db.getSystemData('vapid');
      if (savedVapid?.publicKey && savedVapid?.privateKey) {
        vapid = savedVapid;
      } else {
        vapid = webpush.generateVAPIDKeys();
        await db.saveSystemData('vapid', vapid).catch(() => {});
      }
    } catch (e) {
      vapid = webpush.generateVAPIDKeys();
    }
  }
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (process.env.ORIGIN || 'mailto:admin@localhost');
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
  } catch (err) {
    console.warn('[WebPush] VAPID details warning:', err.message);
  }
}

async function sendPush(userId, payload) {
  try {
    const subs = await db.getPushSubscriptions(userId);
    if (!subs || !subs.length) return;
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' });
      } catch (e) {
        console.error('Push send failed for user', userId, e.statusCode, e.body || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.removePushSubscription(userId, sub.endpoint).catch(() => {});
        }
      }
    }));
  } catch (err) {
    console.error('sendPush error:', err.message);
  }
}

const restTimers = new Map();
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over \ud83d\udcaa', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}

function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; }
}

// Background reminder check interval
setInterval(async () => {
  try {
    const users = await db.listUsers();
    for (const user of users) {
      const subs = await db.getPushSubscriptions(user.id);
      if (!subs || !subs.length) continue;
      const S = await db.getUserState(user.id);
      if (!S?.reminder?.on) continue;
      const now = userNow(S.reminder.tz || 'UTC');
      if (!now || S.reminder.time !== now.hhmm) continue;
      if (user.lastReminder === now.date) continue;
      if ((S.workouts || []).some(w => w.d === now.date)) continue;
      const rid = effectiveRoutineId(S, now.date);
      if (!rid) continue;
      const routine = (S.routines || []).find(r => r.id === rid);
      await db.updateProfile(user.id, { lastReminder: now.date });
      sendPush(user.id, {
        title: routine ? `${routine.emoji || '\ud83c\udfcb\ufe0f'} ${routine.name} today` : 'Workout planned today',
        body: "It's on your plan — let's go \ud83d\udcaa",
        tag: 'day-reminder'
      });
    }
  } catch (err) {
    // Ignore transient loop errors
  }
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}

const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}

async function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = await db.getUser(uid);
  if (!user) return null;
  if (user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}

async function requireAdmin(req, res) {
  const user = await readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}

function sessionCookie(user, req) {
  const isHttps = (req?.headers?.['x-forwarded-proto'] === 'https') || (req?.socket?.encrypted) || false;
  const secure = isHttps ? ' Secure;' : '';
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${secure} SameSite=Lax`;
}

function clearCookie(req) {
  const isHttps = (req?.headers?.['x-forwarded-proto'] === 'https') || (req?.socket?.encrypted) || false;
  const secure = isHttps ? ' Secure;' : '';
  return `gymsid=; Path=/; Max-Age=0; HttpOnly;${secure} SameSite=Lax`;
}

/* ---------- challenge store ---------- */
const challenges = new Map();
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence ---------- */
const presence = new Map();
const PRESENCE_TTL = 70000;
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- API routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => {
    const provider = db.getDatabaseProviderName();
    try {
      const users = await db.listUsers();
      json(res, 200, { ok: true, provider, storage: provider, users: users.length });
    } catch (e) {
      json(res, 200, { ok: true, provider, storage: provider, users: 0, status: 'connecting', notice: e.message });
    }
  },

  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();

    if (INVITE_ONLY) {
      const invite = await db.getInvite(code);
      if (!invite || invite.usedBy || invite.revoked) {
        return json(res, 403, { error: 'a valid invite code is required' });
      }
    }

    const uid = crypto.randomBytes(12).toString('base64url');
    const rpID = getReqRpId(req);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: Buffer.from(uid),
      userName: name,
      userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code, rpID });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    const expectedRPID = [c.rpID, getReqRpId(req), 'localhost'].filter(Boolean);
    const expectedOrigin = getReqOrigins(req);
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;

    const existingPasskey = await db.findPasskey(credential.id);
    if (existingPasskey) return json(res, 409, { error: 'credential already registered' });

    let invite = null;
    if (INVITE_ONLY) {
      invite = await db.getInvite(c.code);
      if (!invite || invite.usedBy || invite.revoked) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }

    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) {
      user.invitedBy = invite.code;
      await db.saveInvite({ ...invite, usedBy: user.id, usedAt: user.created });
    }

    await db.createProfile(user.id, user);
    await db.addPasskey(user.id, {
      id: credential.id,
      userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });

    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user, req) });
  },

  'POST /api/login/options': async (req, res) => {
    const rpID = getReqRpId(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, rpID });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });

    const found = await db.findPasskey(body.credential?.id);
    if (!found || !found.cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    const { cred, user } = found;

    let verification;
    const expectedRPID = [c.rpID, getReqRpId(req), 'localhost'].filter(Boolean);
    const expectedOrigin = getReqOrigins(req);
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });

    await db.updatePasskeyCounter(user.id, cred.id, verification.authenticationInfo.newCounter);

    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user, req) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) }),

  'POST /api/logout/all': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const nextSv = sessionVersion(user) + 1;
    await db.updateProfile(user.id, { sv: nextSv });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
  },

  'GET /api/data': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = await db.getUserState(user.id);
      json(res, 200, { state: state || null });
    } catch (err) {
      json(res, 200, { state: null });
    }
  },

  'PUT /api/data': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    const saved = await db.saveUserState(user.id, body.state);
    json(res, 200, { ok: true, ts: saved._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    await db.savePushSubscription(user.id, sub);
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    await db.removePushSubscription(user.id, body.endpoint);
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: 'Test notification \u2705 — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  'POST /api/activity': async (req, res) => {
    const user = await readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  'GET /api/admin/users': async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const users = await db.listUsers();
    const result = await Promise.all(users.map(async u => {
      const S = (await db.getUserState(u.id)) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      const subs = await db.getPushSubscriptions(u.id);
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: subs.length > 0,
        live: livePresence(u.id)
      };
    }));
    json(res, 200, { users: result, invite_only: INVITE_ONLY, now: Date.now() });
  },

  'GET /api/admin/user': async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = await db.getUser(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = (await db.getUserState(u.id)) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const body = await readBody(req);
    const u = await db.getUser(body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    const disabled = !!body.disabled;
    await db.updateProfile(u.id, { disabled });
    if (disabled) presence.delete(u.id);
    json(res, 200, { ok: true, id: u.id, disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const invites = await db.listInvites();
    const users = await db.listUsers();
    const userMap = new Map(users.map(u => [u.id, u.name]));
    const result = invites.map(i => ({
      ...i, usedByName: i.usedBy ? userMap.get(i.usedBy) || null : null
    }));
    json(res, 200, { invites: result, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    let code;
    const existing = await db.listInvites();
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (existing.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    await db.saveInvite(invite);
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const body = await readBody(req);
    const inv = await db.getInvite(String(body.code || ''));
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    await db.revokeInvite(inv.code);
    json(res, 200, { ok: true });
  }
};

/* ---------- static media & MIME helpers ---------- */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function serveStaticFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  let cacheControl = 'no-cache, must-revalidate';
  if (filePath.includes(`${path.sep}assets${path.sep}`) || ext.match(/\.(woff|woff2|ttf|eot)$/)) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (ext.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) {
    cacheControl = 'public, max-age=86400';
  } else if (ext === '.html') {
    cacheControl = 'no-cache, must-revalidate';
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  });
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl
  });
  stream.pipe(res);
}

function fetchMediaStream(targetUrl, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const protocol = targetUrl.startsWith('https') ? https : http;
    const req = protocol.get(targetUrl, { timeout: 10000 }, (stream) => {
      if (stream.statusCode >= 300 && stream.statusCode < 400 && stream.headers.location && maxRedirects > 0) {
        const nextUrl = new URL(stream.headers.location, targetUrl).toString();
        stream.resume();
        return resolve(fetchMediaStream(nextUrl, maxRedirects - 1));
      }
      if (stream.statusCode === 200) {
        return resolve(stream);
      }
      stream.resume();
      reject(new Error(`HTTP ${stream.statusCode}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
  });
}

async function serveMediaFile(relPath, res, mediaDir, publicDir, distDir) {
  // 1. Check local media directory and fallback paths
  const candidatePaths = [
    path.resolve(mediaDir, relPath),
    path.resolve(process.cwd(), relPath),
    path.resolve(publicDir, relPath),
    path.resolve(distDir, relPath)
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return serveStaticFile(p, res);
    }
  }

  // 2. Stream from exercise CDN with fallback and local background caching
  const filename = path.basename(relPath);
  const isGif = relPath.startsWith('gif/');
  const cdnCandidates = isGif
    ? [
        `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/${filename}`,
        `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/${filename}`
      ]
    : [
        `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/${filename}`,
        `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/${filename}`
      ];

  const ext = path.extname(relPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || (isGif ? 'image/gif' : 'image/jpeg');

  for (const cdnUrl of cdnCandidates) {
    try {
      const stream = await fetchMediaStream(cdnUrl);
      if (res.headersSent) return;

      res.writeHead(200, {
        'Content-Type': stream.headers['content-type'] || contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });

      // Cache locally in background for fast future requests
      const localCachePath = path.resolve(mediaDir, relPath);
      try {
        fs.mkdirSync(path.dirname(localCachePath), { recursive: true });
        const fileOut = fs.createWriteStream(localCachePath);
        fileOut.on('error', () => {}); // Ignore write error if volume is read-only
        stream.pipe(fileOut);
      } catch {}

      stream.pipe(res);
      return;
    } catch {
      // Try next CDN fallback
    }
  }

  if (!res.headersSent) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Media not found');
  }
}

/* ---------- initialize server with Vite integration ---------- */
async function startServer() {
  await db.initDatabase();
  initVapid().catch(err => console.warn('[WebPush] VAPID background init notice:', err.message));

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');
  const publicDir = path.resolve(process.cwd(), 'public');
  const mediaDir = path.resolve(process.cwd(), 'media');
  let viteServer = null;

  // In development mode when dist is not built or explicitly development, load Vite middleware
  if (!isProd && !fs.existsSync(path.join(distDir, 'index.html'))) {
    try {
      const { createServer: createViteServer } = await import('vite');
      viteServer = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom'
      });
    } catch (err) {
      console.warn('Vite middleware mode initialization warning:', err.message);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    // 1. API routes
    if (pathname.startsWith('/api')) {
      const key = req.method + ' ' + pathname;
      const handler = routes[key];
      if (!handler) return json(res, 404, { error: 'not found' });
      try {
        await handler(req, res);
      } catch (e) {
        console.error(key, e);
        if (!res.headersSent) json(res, 500, { error: 'server error' });
      }
      return;
    }

    // 2. Media routes (/img/*, /gif/*)
    if (pathname.startsWith('/img/') || pathname.startsWith('/gif/')) {
      const relPath = pathname.slice(1);
      return serveMediaFile(relPath, res, mediaDir, publicDir, distDir);
    }

    // 3. Vite development middleware mode
    if (viteServer) {
      viteServer.middlewares(req, res, async () => {
        try {
          const reqUrl = req.url || '/';
          const indexPath = path.resolve(process.cwd(), 'index.html');
          if (fs.existsSync(indexPath)) {
            let template = fs.readFileSync(indexPath, 'utf-8');
            template = await viteServer.transformIndexHtml(reqUrl, template);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(template);
            return;
          }
        } catch (e) {
          viteServer.ssrFixStacktrace(e);
          console.error(e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(e.message);
          }
          return;
        }

        const publicFile = path.resolve(publicDir, pathname.slice(1));
        if (publicFile.startsWith(publicDir) && fs.existsSync(publicFile) && fs.statSync(publicFile).isFile()) {
          return serveStaticFile(publicFile, res);
        }
        if (!res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
        }
      });
      return;
    }

    // 4. Production Static File & SPA Serving
    const cleanPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const staticFile = path.resolve(distDir, cleanPath);

    // Serve exact file if found in dist/
    if (staticFile.startsWith(distDir) && fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
      return serveStaticFile(staticFile, res);
    }

    // Check public directory fallback
    const publicFile = path.resolve(publicDir, cleanPath);
    if (publicFile.startsWith(publicDir) && fs.existsSync(publicFile) && fs.statSync(publicFile).isFile()) {
      return serveStaticFile(publicFile, res);
    }

    // If path has a file extension and was not found, return 404
    const ext = path.extname(pathname);
    if (ext && ext !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Asset not found');
      return;
    }

    // SPA fallback -> serve dist/index.html
    const indexHtml = path.resolve(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return serveStaticFile(indexHtml, res);
    }

    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend build not found. Run "npm run build" before starting the production server.');
  });

  server.listen(PORT, '0.0.0.0', () => {
    const provider = db.getDatabaseProviderName();
    const providerTitle = provider === 'firebase' ? 'Firebase RTDB' : provider === 'mysql' ? 'MySQL' : provider === 'mongodb' ? 'MongoDB' : provider.toUpperCase();
    console.log(`====================================\n openGym (${providerTitle})\n====================================`);
    console.log(`Frontend : http://localhost:${PORT}`);
    console.log(`API      : http://localhost:${PORT}/api`);
    console.log(`Database : ${providerTitle}`);
    console.log(`Server running on: http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
