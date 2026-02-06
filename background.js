/**
 * WarehouseMeals Chrome Extension - Background Service Worker
 *
 * This script runs in the background and coordinates between:
 * - The popup UI
 * - The content script running on costco.com
 * - The WarehouseMeals API
 *
 * WHAT THIS SCRIPT DOES:
 * 1. Manages authentication with WarehouseMeals (OAuth flow)
 * 2. Coordinates receipt syncing between Costco and WarehouseMeals
 * 3. Stores ONLY the WarehouseMeals API token (never Costco credentials)
 *
 * WHAT THIS SCRIPT DOES NOT DO:
 * - Store or access Costco passwords or credentials
 * - Send Costco data anywhere except WarehouseMeals
 * - Run in the background when not actively syncing
 */

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  // Change to 'https://warehousemeals.com' for production
  warehouseMealsUrl: 'https://warehousemeals.test',
  fetchTimeoutMs: 15000,
};

// ============================================================
// Sync State
// ============================================================

let syncState = {
  inProgress: false,
  progress: null, // e.g. { current: 3, total: 10, phase: 'fetching' }
};

// ============================================================
// Utilities
// ============================================================

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Broadcasts a progress update to any open popup.
 */
function broadcastProgress(progress) {
  syncState.progress = progress;
  chrome.runtime.sendMessage({ type: 'syncProgress', progress }).catch(() => {
    // Popup may not be open - that's fine
  });
}

/**
 * Filters receipt data to only include fields expected by WarehouseMeals API.
 * This ensures we don't accidentally send extra data from Costco's API.
 */
function filterReceiptData(receipt) {
  return {
    transactionBarcode: receipt.transactionBarcode,
    transactionDateTime: receipt.transactionDateTime,
    warehouseName: receipt.warehouseName,
    warehouseNumber: receipt.warehouseNumber,
    subTotal: receipt.subTotal,
    taxes: receipt.taxes,
    total: receipt.total,
    instantSavings: receipt.instantSavings,
    totalItemCount: receipt.totalItemCount,
    itemArray: (receipt.itemArray || []).map((item) => ({
      itemNumber: item.itemNumber,
      itemDescription01: item.itemDescription01,
      itemDescription02: item.itemDescription02,
      amount: item.amount,
      unit: item.unit,
      itemUnitPriceAmount: item.itemUnitPriceAmount,
    })),
  };
}

// ============================================================
// Storage Helpers
// ============================================================

/**
 * Reads data from extension storage.
 * We only store the WarehouseMeals API token here.
 */
async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

/**
 * Writes data to extension storage.
 */
async function setStorage(data) {
  return chrome.storage.local.set(data);
}

// ============================================================
// WarehouseMeals Authentication
// ============================================================

/**
 * Initiates OAuth authentication with WarehouseMeals.
 * Opens a popup where the user can authorize the extension.
 * On success, stores the API token for future requests.
 */
async function authenticateWithWarehouseMeals() {
  // Get the Chrome extension's OAuth callback URL
  const redirectUri = chrome.identity.getRedirectURL();

  // Build the authorization URL
  const authUrl = `${CONFIG.warehouseMealsUrl}/auth/extension/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;

  return new Promise((resolve, reject) => {
    // Open the auth popup
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!responseUrl) {
          reject(new Error('Authorization was cancelled'));
          return;
        }

        try {
          // Extract the token from the callback URL
          const url = new URL(responseUrl);
          const token = url.searchParams.get('token');

          if (!token) {
            reject(new Error('No token received from WarehouseMeals'));
            return;
          }

          // Store the token for future API calls
          await setStorage({ warehouseMealsToken: token });
          resolve({ success: true });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * Removes the WarehouseMeals API token, effectively logging out.
 */
async function disconnectFromWarehouseMeals() {
  await chrome.storage.local.remove(['warehouseMealsToken']);
  return { success: true };
}

/**
 * Custom error class to distinguish network errors from auth errors.
 */
class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Makes an authenticated request to the WarehouseMeals API.
 * Retries once on 401 before clearing the token.
 *
 * @returns {Promise<Response>} The fetch response
 * @throws {NetworkError} On network/timeout errors
 * @throws {Error} On auth errors or if not authenticated
 */
async function authenticatedFetch(url, options = {}) {
  const { warehouseMealsToken } = await getStorage(['warehouseMealsToken']);

  if (!warehouseMealsToken) {
    throw new Error('Not connected to WarehouseMeals. Please connect your account.');
  }

  const fetchOptions = {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
      'Authorization': `Bearer ${warehouseMealsToken}`,
    },
  };

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    throw new NetworkError('Network error. Please check your connection and try again.');
  }

  // Handle 401: retry once before clearing token (handles transient failures)
  if (response.status === 401) {
    console.log('[WarehouseMeals] Got 401, retrying once...');
    await delay(1000);

    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      throw new NetworkError('Network error. Please check your connection and try again.');
    }

    if (response.status === 401) {
      console.log('[WarehouseMeals] Token confirmed invalid, clearing...');
      await chrome.storage.local.remove(['warehouseMealsToken']);
      throw new Error('Session expired. Please reconnect your account.');
    }
  }

  return response;
}

/**
 * Validates the stored token by calling the user endpoint.
 * Returns { valid: true }, { valid: false }, or { valid: false, networkError: true }.
 */
async function validateToken() {
  const { warehouseMealsToken } = await getStorage(['warehouseMealsToken']);

  if (!warehouseMealsToken) {
    return { valid: false };
  }

  try {
    const response = await authenticatedFetch(`${CONFIG.warehouseMealsUrl}/api/user`);
    return { valid: response.ok };
  } catch (err) {
    if (err instanceof NetworkError) {
      return { valid: false, networkError: true };
    }
    // Token was cleared by authenticatedFetch on confirmed 401
    return { valid: false };
  }
}

// ============================================================
// Costco Tab Communication
// ============================================================

/**
 * Finds an open tab with costco.com loaded.
 * Returns the tab object or null if no Costco tab is open.
 */
async function findCostcoTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.costco.com/*' });
  return tabs[0] || null;
}

/**
 * Sends a message to the content script running on costco.com.
 * The content script handles all Costco API communication.
 */
// Store active content script ports by tab ID
const contentPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'costco') return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  contentPorts.set(tabId, port);

  port.onDisconnect.addListener(() => {
    contentPorts.delete(tabId);
  });
});

async function messageContentScript(message) {
  const tab = await findCostcoTab();

  if (!tab) {
    throw new Error('Please open costco.com in a browser tab');
  }

  const port = contentPorts.get(tab.id);
  if (!port) {
    throw new Error('Could not connect to costco.com. Please refresh the page.');
  }

  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);

    const listener = (response) => {
      if (response.id !== id) return;
      port.onMessage.removeListener(listener);
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.result);
      }
    };

    port.onMessage.addListener(listener);
    port.postMessage({ ...message, id });
  });
}

/**
 * Checks if the user is logged into Costco by asking the content script.
 */
async function isCostcoLoggedIn() {
  try {
    const response = await messageContentScript({ action: 'checkCostcoLogin' });
    return response?.loggedIn || false;
  } catch (err) {
    return false;
  }
}

// ============================================================
// Receipt Syncing
// ============================================================

/**
 * Fetches receipts from Costco via the content script.
 */
async function fetchCostcoReceipts(startDate, endDate) {
  return messageContentScript({
    action: 'fetchCostcoReceipts',
    startDate,
    endDate,
  });
}

/**
 * Fetches details for a single receipt via the content script.
 */
async function fetchCostcoReceiptDetails(barcode) {
  return messageContentScript({
    action: 'fetchCostcoReceiptDetails',
    barcode,
  });
}

/**
 * Sends receipt data to the WarehouseMeals API.
 */
async function sendReceiptsToWarehouseMeals(receipts) {
  const response = await authenticatedFetch(`${CONFIG.warehouseMealsUrl}/api/receipts/import`, {
    method: 'POST',
    body: JSON.stringify({ receipts }),
  });

  if (!response.ok) {
    // Try to parse as JSON for validation errors
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        const json = await response.json();
        // Laravel validation error format
        if (response.status === 422 && json.message) {
          throw new Error(`Validation failed: ${json.message}`);
        }
        throw new Error(json.message || `Server error: ${response.status}`);
      } catch (e) {
        if (e.message.startsWith('Validation failed:') || e.message.startsWith('Server error:')) {
          throw e;
        }
      }
    }
    throw new Error(`Server error: ${response.status}`);
  }

  return response.json();
}

/**
 * Main sync function: fetches receipts from Costco and sends them to WarehouseMeals.
 *
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 */
async function syncReceipts(startDate, endDate) {
  if (syncState.inProgress) {
    throw new Error('A sync is already in progress. Please wait for it to finish.');
  }

  syncState.inProgress = true;
  syncState.progress = null;

  try {
    // Step 1: Fetch receipt list from Costco
    broadcastProgress({ phase: 'listing', message: 'Fetching receipt list from Costco...' });
    const receipts = await fetchCostcoReceipts(startDate, endDate);

    if (!receipts || receipts.length === 0) {
      return { success: true, message: 'No receipts found for this date range.', count: 0 };
    }

    // Step 2: Fetch full details for each receipt (rate limited to 1/sec)
    const detailedReceipts = [];
    const failedReceipts = [];

    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];
      broadcastProgress({
        phase: 'fetching',
        current: i + 1,
        total: receipts.length,
        message: `Fetching receipt ${i + 1} of ${receipts.length}...`,
      });

      try {
        const details = await fetchCostcoReceiptDetails(receipt.transactionBarcode);
        if (details) {
          detailedReceipts.push(details);
        } else {
          failedReceipts.push(receipt.transactionBarcode);
        }
      } catch (err) {
        console.error(`Failed to fetch receipt ${receipt.transactionBarcode}:`, err);
        failedReceipts.push(receipt.transactionBarcode);
      }

      // Rate limit: wait 1 second between requests (skip after last one)
      if (i < receipts.length - 1) {
        await delay(1000);
      }
    }

    // If all fetches failed, surface the error
    if (detailedReceipts.length === 0 && failedReceipts.length > 0) {
      throw new Error(
        `Failed to fetch details for all ${failedReceipts.length} receipt(s). ` +
        'Costco may be experiencing issues. Please try again later.'
      );
    }

    // Step 3: Filter to only expected fields and send to WarehouseMeals
    broadcastProgress({ phase: 'importing', message: 'Sending receipts to WarehouseMeals...' });
    const filteredReceipts = detailedReceipts.map(filterReceiptData);
    const result = await sendReceiptsToWarehouseMeals(filteredReceipts);

    // Build a detailed result using the API response
    return {
      success: true,
      imported: result.imported ?? detailedReceipts.length,
      duplicates: result.duplicates ?? 0,
      skipped: result.skipped ?? 0,
      errors: Array.isArray(result.errors) ? result.errors.length : (result.errors ?? 0),
      fetchFailed: failedReceipts.length,
    };
  } finally {
    syncState.inProgress = false;
    syncState.progress = null;
    broadcastProgress(null);
  }
}

// ============================================================
// Message Handler
// ============================================================

/**
 * Handles messages from the popup UI.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore our own broadcast messages
  if (message.type === 'syncProgress') {
    return false;
  }

  const handleMessage = async () => {
    switch (message.action) {
      // Get current connection status for both services
      case 'getStatus': {
        // If a sync is running, return cached state without re-validating
        if (syncState.inProgress) {
          const { warehouseMealsToken } = await getStorage(['warehouseMealsToken']);
          const costcoTab = await findCostcoTab();
          return {
            warehouseMealsConnected: !!warehouseMealsToken,
            costcoConnected: true, // Must be true if sync started
            hasCostcoTab: !!costcoTab,
            syncInProgress: true,
            syncProgress: syncState.progress,
          };
        }

        const { warehouseMealsToken } = await getStorage(['warehouseMealsToken']);
        const costcoTab = await findCostcoTab();
        const costcoLoggedIn = costcoTab ? await isCostcoLoggedIn() : false;

        // Validate token if we have one
        let warehouseMealsConnected = false;
        let networkError = false;

        if (warehouseMealsToken) {
          const validation = await validateToken();
          warehouseMealsConnected = validation.valid;
          networkError = validation.networkError || false;
        }

        return {
          warehouseMealsConnected,
          costcoConnected: costcoLoggedIn,
          hasCostcoTab: !!costcoTab,
          networkError,
          syncInProgress: false,
        };
      }

      // Connect to WarehouseMeals
      case 'authenticateWarehouseMeals':
        return authenticateWithWarehouseMeals();

      // Disconnect from WarehouseMeals
      case 'disconnectWarehouseMeals':
        return disconnectFromWarehouseMeals();

      // Sync receipts from Costco to WarehouseMeals
      case 'syncReceipts': {
        const endDate = message.endDate || new Date().toISOString().split('T')[0];
        const startDate = message.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        return syncReceipts(startDate, endDate);
      }

      default:
        throw new Error(`Unknown action: ${message.action}`);
    }
  };

  handleMessage()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  return true; // Required for async sendResponse
});

console.log('[WarehouseMeals] Extension loaded');
