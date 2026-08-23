import { loadEnv } from './env.js';

loadEnv();

let activeProvider = null;
let activeProviderName = null;

export function getDatabaseProviderName() {
  loadEnv();
  return (process.env.DATABASE_PROVIDER || 'firebase').trim().toLowerCase();
}

/**
 * Initializes and returns the active database provider.
 * Only the selected provider module is loaded and initialized.
 */
export async function getProvider() {
  if (activeProvider) return activeProvider;

  loadEnv();
  const providerName = getDatabaseProviderName();

  switch (providerName) {
    case 'firebase': {
      const firebaseProvider = await import('./providers/firebase.js');
      firebaseProvider.initFirebase();
      activeProvider = firebaseProvider;
      activeProviderName = 'firebase';
      break;
    }
    case 'mysql': {
      const mysqlProvider = await import('./providers/mysql.js');
      await mysqlProvider.initMySQL();
      activeProvider = mysqlProvider;
      activeProviderName = 'mysql';
      break;
    }
    case 'mongodb': {
      const mongoProvider = await import('./providers/mongodb.js');
      await mongoProvider.initMongoDB();
      activeProvider = mongoProvider;
      activeProviderName = 'mongodb';
      break;
    }
    default:
      throw new Error(`[Database] Invalid DATABASE_PROVIDER: "${providerName}". Supported providers are 'firebase', 'mysql', or 'mongodb'.`);
  }

  return activeProvider;
}

export async function initDatabase() {
  return await getProvider();
}

// -------------------------------------------------------------
// UNIFIED DATA ACCESS LAYER (DELEGATES TO ACTIVE PROVIDER)
// -------------------------------------------------------------

export async function getProfile(userId) {
  const p = await getProvider();
  return await p.getProfile(userId);
}

export async function createProfile(userId, profileData) {
  const p = await getProvider();
  return await p.createProfile(userId, profileData);
}

export async function updateProfile(userId, updates) {
  const p = await getProvider();
  return await p.updateProfile(userId, updates);
}

export async function getUser(userId) {
  const p = await getProvider();
  return await p.getUser(userId);
}

export async function createUser(userData) {
  const p = await getProvider();
  return await p.createUser(userData);
}

export async function updateUser(userId, data) {
  const p = await getProvider();
  return await p.updateUser(userId, data);
}

export async function deleteUser(userId) {
  const p = await getProvider();
  return await p.deleteUser(userId);
}

export async function listUsers() {
  const p = await getProvider();
  return await p.listUsers();
}

export async function addPasskey(userId, passkeyData) {
  const p = await getProvider();
  return await p.addPasskey(userId, passkeyData);
}

export async function getPasskeys(userId) {
  const p = await getProvider();
  return await p.getPasskeys(userId);
}

export async function findPasskey(credId) {
  const p = await getProvider();
  return await p.findPasskey(credId);
}

export async function updatePasskeyCounter(userId, credId, newCounter) {
  const p = await getProvider();
  return await p.updatePasskeyCounter(userId, credId, newCounter);
}

export async function getUserState(userId) {
  const p = await getProvider();
  return await p.getUserState(userId);
}

export async function saveUserState(userId, state) {
  const p = await getProvider();
  return await p.saveUserState(userId, state);
}

export async function getPlan(userId) {
  const p = await getProvider();
  return await p.getPlan(userId);
}

export async function updatePlan(userId, planData) {
  const p = await getProvider();
  return await p.updatePlan(userId, planData);
}

export async function getWorkouts(userId) {
  const p = await getProvider();
  return await p.getWorkouts(userId);
}

export async function saveWorkout(userId, workout) {
  const p = await getProvider();
  return await p.saveWorkout(userId, workout);
}

export async function deleteWorkout(userId, workoutIdentifier) {
  const p = await getProvider();
  return await p.deleteWorkout(userId, workoutIdentifier);
}

export async function getBodyWeight(userId) {
  const p = await getProvider();
  return await p.getBodyWeight(userId);
}

export async function saveBodyWeight(userId, bwEntry) {
  const p = await getProvider();
  return await p.saveBodyWeight(userId, bwEntry);
}

export async function getSettings(userId) {
  const p = await getProvider();
  return await p.getSettings(userId);
}

export async function updateSettings(userId, settingsData) {
  const p = await getProvider();
  return await p.updateSettings(userId, settingsData);
}

export async function listInvites() {
  const p = await getProvider();
  return await p.listInvites();
}

export async function getInvite(code) {
  const p = await getProvider();
  return await p.getInvite(code);
}

export async function saveInvite(invite) {
  const p = await getProvider();
  return await p.saveInvite(invite);
}

export async function revokeInvite(code) {
  const p = await getProvider();
  return await p.revokeInvite(code);
}

export async function getPushSubscriptions(userId) {
  const p = await getProvider();
  return await p.getPushSubscriptions(userId);
}

export async function listAllPushSubscriptions() {
  const p = await getProvider();
  return await p.listAllPushSubscriptions();
}

export async function savePushSubscription(userId, sub) {
  const p = await getProvider();
  return await p.savePushSubscription(userId, sub);
}

export async function removePushSubscription(userId, endpoint) {
  const p = await getProvider();
  return await p.removePushSubscription(userId, endpoint);
}

export async function removePushSubscriptionByEndpoint(endpoint) {
  const p = await getProvider();
  return await p.removePushSubscriptionByEndpoint(endpoint);
}

export async function getSystemData(key) {
  const p = await getProvider();
  return await p.getSystemData(key);
}

export async function saveSystemData(key, value) {
  const p = await getProvider();
  return await p.saveSystemData(key, value);
}
