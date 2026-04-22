// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
// 🔧 HOW TO SETUP FIREBASE:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project
// 3. Go to Project Settings > Your apps > Web app
// 4. Copy your config and paste it below
// 5. Enable Realtime Database in Firebase console
// 6. Set Realtime Database rules to:
//    {
//      "rules": {
//        ".read": true,
//        ".write": true
//      }
//    }
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCp9_P3K__Sr76iKgaVG1iD4NluUqPtni4",
  authDomain: "heka-codenames.firebaseapp.com",
  databaseURL: "https://heka-codenames-default-rtdb.firebaseio.com",
  projectId: "heka-codenames",
  storageBucket: "heka-codenames.firebasestorage.app",
  messagingSenderId: "901713932504",
  appId: "1:901713932504:web:b6710ddf537cd3c7c4e7ad"
};

// ============================================================
// Firebase Manager
// ============================================================
class FirebaseManager {
  constructor() {
    this.db = null;
    this.app = null;
    this.initialized = false;
    this.listeners = [];
  }

  async init(config) {
    try {
      // Dynamic import for Firebase modular SDK
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
      const { getDatabase, ref, set, get, onValue, push, remove, update, off, serverTimestamp } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

      this.app = initializeApp(config);
      this.db = getDatabase(this.app);
      this.dbFns = { ref, set, get, onValue, push, remove, update, off, serverTimestamp };
      this.initialized = true;
      console.log('✅ Firebase initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error);
      return false;
    }
  }

  async writeRoom(roomCode, data) {
    if (!this.initialized) return false;
    const { ref, set } = this.dbFns;
    try {
      await set(ref(this.db, `rooms/${roomCode}`), data);
      return true;
    } catch (e) {
      console.error('writeRoom error:', e);
      return false;
    }
  }

  async updateRoom(roomCode, data) {
    if (!this.initialized) return false;
    const { ref, update } = this.dbFns;
    try {
      await update(ref(this.db, `rooms/${roomCode}`), data);
      return true;
    } catch (e) {
      console.error('updateRoom error:', e);
      return false;
    }
  }

  async updatePath(path, data) {
    if (!this.initialized) return false;
    const { ref, update } = this.dbFns;
    try {
      await update(ref(this.db, path), data);
      return true;
    } catch (e) {
      console.error('updatePath error:', e);
      return false;
    }
  }

  async setPath(path, data) {
    if (!this.initialized) return false;
    const { ref, set } = this.dbFns;
    try {
      await set(ref(this.db, path), data);
      return true;
    } catch (e) {
      console.error('setPath error:', e);
      return false;
    }
  }

  async getRoom(roomCode) {
    if (!this.initialized) return null;
    const { ref, get } = this.dbFns;
    try {
      const snapshot = await get(ref(this.db, `rooms/${roomCode}`));
      return snapshot.exists() ? snapshot.val() : null;
    } catch (e) {
      console.error('getRoom error:', e);
      return null;
    }
  }

  async getPath(path) {
    if (!this.initialized) return null;
    const { ref, get } = this.dbFns;
    try {
      const snapshot = await get(ref(this.db, path));
      return snapshot.exists() ? snapshot.val() : null;
    } catch (e) {
      console.error('getPath error:', e);
      return null;
    }
  }

  listenToRoom(roomCode, callback) {
    if (!this.initialized) return null;
    const { ref, onValue } = this.dbFns;
    const roomRef = ref(this.db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, (snapshot) => {
      callback(snapshot.exists() ? snapshot.val() : null);
    });
    this.listeners.push({ ref: roomRef, fn: unsub });
    return unsub;
  }

  listenToPath(path, callback) {
    if (!this.initialized) return null;
    const { ref, onValue } = this.dbFns;
    const pathRef = ref(this.db, path);
    const unsub = onValue(pathRef, (snapshot) => {
      callback(snapshot.exists() ? snapshot.val() : null);
    });
    this.listeners.push({ ref: pathRef, fn: unsub });
    return unsub;
  }

  async deleteRoom(roomCode) {
    if (!this.initialized) return false;
    const { ref, remove } = this.dbFns;
    try {
      await remove(ref(this.db, `rooms/${roomCode}`));
      return true;
    } catch (e) {
      console.error('deleteRoom error:', e);
      return false;
    }
  }

  detachAllListeners() {
    this.listeners.forEach(({ ref: r, fn }) => {
      if (fn) fn(); // Firebase v9 unsubscribe is the returned function
    });
    this.listeners = [];
  }

  // Generate a unique room code
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  serverTimestamp() {
    if (this.initialized && this.dbFns) {
      return this.dbFns.serverTimestamp();
    }
    return Date.now();
  }
}

// Singleton instance
window.firebaseManager = new FirebaseManager();

// Auto-init on load
(async () => {
  await window.firebaseManager.init(FIREBASE_CONFIG);
})();
