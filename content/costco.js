/**
 * WarehouseMeals Chrome Extension - Costco Content Script
 *
 * This script runs on costco.com and handles communication with Costco's API.
 *
 * PRIVACY & SECURITY:
 * - This script NEVER stores or transmits your Costco credentials
 * - It reads the session token from localStorage only when you click "Sync"
 * - The token is used solely to fetch YOUR receipts from Costco's API
 * - All API calls happen directly from your browser to Costco's servers
 * - No Costco data is sent anywhere except to your WarehouseMeals account
 *
 * HOW IT WORKS:
 * 1. When you're logged into costco.com, Costco stores a session token in localStorage
 * 2. When you click "Sync" in the extension, this script reads that token
 * 3. The script uses the token to call Costco's receipt API (same API the website uses)
 * 4. Receipt data is sent to the background script, then to WarehouseMeals
 * 5. The token is never saved - it's read fresh each time you sync
 */

(function () {
  'use strict';

  // Costco API configuration (same values the costco.com website uses)
  const COSTCO_API = {
    url: 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql',
    timeoutMs: 30000,
    headers: {
      'Accept': '*/*',
      'Content-Type': 'application/json-patch+json',
      'client-identifier': '481b1aec-aa3b-454b-b81b-48187e28f205',
      'costco-x-wcs-clientId': '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf',
      'costco.env': 'ecom',
      'costco.service': 'restOrders',
    },
  };

  /**
   * Creates a fetch call with a timeout via AbortController.
   */
  function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COSTCO_API.timeoutMs);

    return fetch(url, { ...options, signal: controller.signal })
      .then((response) => {
        clearTimeout(timeoutId);
        return response;
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Costco API request timed out. Please try again.');
        }
        throw new Error('Network error connecting to Costco. Please check your connection.');
      });
  }

  /**
   * Gets the user's Costco session token from localStorage.
   * This token is created by Costco when you log in - we just read it.
   * Returns null if the user is not logged in.
   */
  function getCostcoSessionToken() {
    const token = localStorage.getItem('idToken');

    // Verify it looks like a valid JWT (three base64 parts separated by dots)
    if (token && token.startsWith('eyJ') && token.split('.').length === 3) {
      return token;
    }

    return null;
  }

  /**
   * Checks if the user is currently logged into Costco.
   */
  function isLoggedIntoCostco() {
    return getCostcoSessionToken() !== null;
  }

  /**
   * Converts a date from YYYY-MM-DD to MM/DD/YYYY format (what Costco's API expects).
   */
  function formatDate(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return `${month}/${day}/${year}`;
  }

  /**
   * Fetches the list of receipts from Costco's API.
   *
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format
   * @returns {Promise<Array>} Array of receipt objects
   */
  async function fetchReceiptList(startDate, endDate) {
    const token = getCostcoSessionToken();
    if (!token) {
      throw new Error('Not logged into Costco. Please sign in at costco.com');
    }

    // GraphQL query to get receipt list (only fields needed by WarehouseMeals)
    const query = `
      query receiptsWithCounts(
        $startDate: String!,
        $endDate: String!,
        $documentType: String!,
        $documentSubType: String!
      ) {
        receiptsWithCounts(
          startDate: $startDate,
          endDate: $endDate,
          documentType: $documentType,
          documentSubType: $documentSubType
        ) {
          receipts {
            transactionBarcode
          }
        }
      }
    `;

    const response = await fetchWithTimeout(COSTCO_API.url, {
      method: 'POST',
      headers: {
        ...COSTCO_API.headers,
        'costco-x-authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          documentType: 'all',
          documentSubType: 'all',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Costco API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || 'Costco API returned an error');
    }

    // Validate expected response structure
    if (!data.data || !data.data.receiptsWithCounts) {
      throw new Error('Unexpected response from Costco API. Their website may have changed.');
    }

    return data.data.receiptsWithCounts.receipts || [];
  }

  /**
   * Fetches detailed information for a single receipt.
   *
   * @param {string} barcode - The transaction barcode of the receipt
   * @returns {Promise<Object|null>} Receipt details or null if not found
   */
  async function fetchReceiptDetails(barcode) {
    const token = getCostcoSessionToken();
    if (!token) {
      throw new Error('Not logged into Costco. Please sign in at costco.com');
    }

    // GraphQL query to get receipt details (only fields needed by WarehouseMeals)
    const query = `
      query receiptsWithCounts($barcode: String!, $documentType: String!) {
        receiptsWithCounts(barcode: $barcode, documentType: $documentType) {
          receipts {
            transactionBarcode
            transactionDateTime
            warehouseName
            warehouseNumber
            subTotal
            taxes
            total
            instantSavings
            totalItemCount
            itemArray {
              itemNumber
              itemDescription01
              itemDescription02
              amount
              unit
              itemUnitPriceAmount
            }
          }
        }
      }
    `;

    const response = await fetchWithTimeout(COSTCO_API.url, {
      method: 'POST',
      headers: {
        ...COSTCO_API.headers,
        'costco-x-authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          barcode,
          documentType: 'all',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Costco API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || 'Costco API returned an error');
    }

    // Validate expected response structure
    if (!data.data || !data.data.receiptsWithCounts) {
      throw new Error('Unexpected response from Costco API. Their website may have changed.');
    }

    return data.data.receiptsWithCounts.receipts?.[0] || null;
  }

  /**
   * Handles messages from the extension's background script.
   * This is how the popup/background communicates with this content script.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handleMessage = async () => {
      switch (message.action) {
        case 'fetchCostcoReceipts':
          return fetchReceiptList(message.startDate, message.endDate);

        case 'fetchCostcoReceiptDetails':
          return fetchReceiptDetails(message.barcode);

        case 'checkCostcoLogin':
          return { loggedIn: isLoggedIntoCostco() };

        case 'ping':
          return { pong: true };

        default:
          throw new Error(`Unknown action: ${message.action}`);
      }
    };

    // Handle async response
    handleMessage()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));

    return true; // Required for async sendResponse
  });

  console.log('[WarehouseMeals] Extension ready');
})();
