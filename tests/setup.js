/**
 * Jest setup file — mock Chrome extension APIs and Web Crypto API.
 */

// In-memory storage backend
const storageData = {};

// Simple no-op function for event listeners and stubs
function noop() {}

const chromeStorageArea = {
  get(keys) {
    if (keys === null) {
      return Promise.resolve({ ...storageData });
    }
    if (typeof keys === 'string') {
      keys = [keys];
    }
    const result = {};
    for (const key of keys) {
      if (key in storageData) {
        result[key] = structuredClone(storageData[key]);
      }
    }
    return Promise.resolve(result);
  },
  set(items) {
    Object.assign(storageData, structuredClone(items));
    return Promise.resolve();
  },
  remove(keys) {
    if (typeof keys === 'string') keys = [keys];
    for (const key of keys) {
      delete storageData[key];
    }
    return Promise.resolve();
  },
  clear() {
    for (const key of Object.keys(storageData)) {
      delete storageData[key];
    }
    return Promise.resolve();
  },
};

globalThis.chrome = {
  storage: {
    local: chromeStorageArea,
  },
  runtime: {
    id: 'test-extension-id-1234',
    sendMessage: noop,
    onMessage: { addListener: noop },
    onInstalled: { addListener: noop },
  },
  contextMenus: {
    create: noop,
    onClicked: { addListener: noop },
  },
  tabs: {
    query: noop,
    sendMessage: noop,
  },
  alarms: {
    create: noop,
    onAlarm: { addListener: noop },
  },
};

// Helper to reset storage between tests
globalThis.__resetChromeStorage = () => {
  for (const key of Object.keys(storageData)) {
    delete storageData[key];
  }
};

// Helper to seed storage data for tests
globalThis.__setChromeStorage = (data) => {
  Object.assign(storageData, structuredClone(data));
};

// Helper to read raw storage data
globalThis.__getChromeStorage = () => ({ ...storageData });
