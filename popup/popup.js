/**
 * WarehouseMeals Chrome Extension - Popup Script
 */

// DOM Elements
const elements = {
  // WarehouseMeals
  wmStatus: document.getElementById('wm-status'),
  wmConnected: document.getElementById('wm-connected'),
  wmDisconnected: document.getElementById('wm-disconnected'),
  wmConnectBtn: document.getElementById('wm-connect'),
  wmDisconnectBtn: document.getElementById('wm-disconnect'),

  // Costco
  costcoStatus: document.getElementById('costco-status'),
  costcoConnected: document.getElementById('costco-connected'),
  costcoDisconnected: document.getElementById('costco-disconnected'),

  // Sync
  syncSection: document.getElementById('sync-section'),
  syncBtn: document.getElementById('sync-btn'),
  syncBtnText: document.querySelector('.btn-text'),
  syncBtnLoading: document.querySelector('.btn-loading'),
  syncBtnLoadingText: document.querySelector('.btn-loading-text'),
  dateRange: document.getElementById('date-range'),
  syncResult: document.getElementById('sync-result'),
};

/**
 * Send message to background script
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Update UI based on connection status
 */
function updateUI(status) {
  // WarehouseMeals status
  if (status.networkError) {
    elements.wmStatus.textContent = 'Network Error';
    elements.wmStatus.className = 'status-badge status-warning';
    elements.wmConnected.classList.add('hidden');
    elements.wmDisconnected.classList.add('hidden');
  } else if (status.warehouseMealsConnected) {
    elements.wmStatus.textContent = 'Connected';
    elements.wmStatus.className = 'status-badge status-connected';
    elements.wmConnected.classList.remove('hidden');
    elements.wmDisconnected.classList.add('hidden');
  } else {
    elements.wmStatus.textContent = 'Disconnected';
    elements.wmStatus.className = 'status-badge status-disconnected';
    elements.wmConnected.classList.add('hidden');
    elements.wmDisconnected.classList.remove('hidden');
  }

  // Costco status
  if (status.costcoConnected) {
    elements.costcoStatus.textContent = 'Connected';
    elements.costcoStatus.className = 'status-badge status-connected';
    elements.costcoConnected.classList.remove('hidden');
    elements.costcoDisconnected.classList.add('hidden');
  } else {
    elements.costcoStatus.textContent = 'Disconnected';
    elements.costcoStatus.className = 'status-badge status-disconnected';
    elements.costcoConnected.classList.add('hidden');
    elements.costcoDisconnected.classList.remove('hidden');
  }

  // Handle sync-in-progress state (sync started before popup opened)
  if (status.syncInProgress) {
    setSyncLoading(true);
    if (status.syncProgress?.message) {
      elements.syncBtnLoadingText.textContent = status.syncProgress.message;
    }
    elements.syncBtn.disabled = true;
    return;
  }

  // Sync button enabled only if both connected AND a Costco tab is open
  const canSync = (status.warehouseMealsConnected || status.networkError) && status.costcoConnected && status.hasCostcoTab;
  elements.syncBtn.disabled = !canSync;

  // Show contextual hints
  if (status.networkError) {
    showSyncResult('Could not reach WarehouseMeals. Check your connection and try again.', 'warning');
  } else if (status.warehouseMealsConnected && !status.hasCostcoTab) {
    showSyncResult('Please open costco.com in a tab', 'error');
  } else if (status.warehouseMealsConnected && status.hasCostcoTab && !status.costcoConnected) {
    showSyncResult('Could not detect Costco login. Try refreshing the costco.com tab.', 'error');
  }
}

/**
 * Show sync result message
 */
function showSyncResult(message, type = 'success') {
  elements.syncResult.textContent = message;
  elements.syncResult.className = `sync-result ${type}`;
  elements.syncResult.classList.remove('hidden');
}

/**
 * Hide sync result message
 */
function hideSyncResult() {
  elements.syncResult.classList.add('hidden');
}

/**
 * Set sync button loading state
 */
function setSyncLoading(loading) {
  if (loading) {
    elements.syncBtn.disabled = true;
    elements.syncBtnText.classList.add('hidden');
    elements.syncBtnLoading.classList.remove('hidden');
    elements.syncBtnLoadingText.textContent = 'Syncing...';
  } else {
    elements.syncBtnText.classList.remove('hidden');
    elements.syncBtnLoading.classList.add('hidden');
  }
}

/**
 * Build a human-readable sync result message from the API response.
 */
function formatSyncResult(result) {
  const parts = [];

  if (result.imported > 0) {
    parts.push(`${result.imported} imported`);
  }
  if (result.duplicates > 0) {
    parts.push(`${result.duplicates} already synced`);
  }
  if (result.skipped > 0) {
    parts.push(`${result.skipped} skipped`);
  }
  if (result.errors > 0) {
    parts.push(`${result.errors} failed`);
  }
  if (result.fetchFailed > 0) {
    parts.push(`${result.fetchFailed} could not be read from Costco`);
  }

  if (parts.length === 0) {
    return 'No new receipts to import.';
  }

  // Capitalize first part
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(', ') + '.';
}

/**
 * Determine the result type (success/warning/error) based on the result data.
 */
function getSyncResultType(result) {
  if (result.errors > 0 || result.fetchFailed > 0) {
    return result.imported > 0 ? 'warning' : 'error';
  }
  return 'success';
}

/**
 * Handle WarehouseMeals connect
 */
async function handleWMConnect() {
  try {
    elements.wmConnectBtn.disabled = true;
    elements.wmConnectBtn.textContent = 'Connecting...';

    await sendMessage({ action: 'authenticateWarehouseMeals' });
    await refreshStatus();
  } catch (err) {
    console.error('Failed to connect:', err);
    showSyncResult(`Failed to connect: ${err.message}`, 'error');
  } finally {
    elements.wmConnectBtn.disabled = false;
    elements.wmConnectBtn.textContent = 'Connect Account';
  }
}

/**
 * Handle WarehouseMeals disconnect
 */
async function handleWMDisconnect() {
  try {
    await sendMessage({ action: 'disconnectWarehouseMeals' });
    await refreshStatus();
  } catch (err) {
    console.error('Failed to disconnect:', err);
  }
}

/**
 * Handle sync
 */
async function handleSync() {
  try {
    hideSyncResult();
    setSyncLoading(true);

    const days = parseInt(elements.dateRange.value, 10);
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await sendMessage({
      action: 'syncReceipts',
      startDate,
      endDate,
    });

    if (result.message) {
      // Simple message (e.g. "No receipts found")
      showSyncResult(result.message, 'success');
    } else {
      // Detailed result from API
      showSyncResult(formatSyncResult(result), getSyncResultType(result));
    }
  } catch (err) {
    console.error('Sync failed:', err);
    showSyncResult(err.message, 'error');
  } finally {
    setSyncLoading(false);
    await refreshStatus();
  }
}

/**
 * Handle progress updates from the background script
 */
function handleSyncProgress(progress) {
  if (!progress) {
    return;
  }
  if (elements.syncBtnLoadingText && progress.message) {
    elements.syncBtnLoadingText.textContent = progress.message;
  }
}

/**
 * Refresh connection status
 */
async function refreshStatus() {
  try {
    const status = await sendMessage({ action: 'getStatus' });
    updateUI(status);
  } catch (err) {
    console.error('Failed to get status:', err);
    updateUI({ warehouseMealsConnected: false, costcoConnected: false, hasCostcoTab: false });
  }
}

/**
 * Initialize popup
 */
async function init() {
  // Set up event listeners
  elements.wmConnectBtn.addEventListener('click', handleWMConnect);
  elements.wmDisconnectBtn.addEventListener('click', handleWMDisconnect);
  elements.syncBtn.addEventListener('click', handleSync);

  // Listen for progress updates from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'syncProgress') {
      handleSyncProgress(message.progress);
    }
  });

  // Get initial status
  await refreshStatus();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
