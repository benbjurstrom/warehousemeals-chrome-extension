# WarehouseMeals Chrome Extension

Sync your Costco receipts to WarehouseMeals with one click.

## What This Extension Does

1. **Connects to your WarehouseMeals account** via secure OAuth flow
2. **Reads your Costco receipts** from costco.com when you click "Sync"
3. **Sends receipt data to WarehouseMeals** to build your personalized food catalog

## Privacy & Security

This extension is designed with your privacy in mind:

### What We Access

- **Costco session token**: Read from `localStorage` only when you click "Sync". This is the same token Costco's website uses to show you your own receipts.
- **Receipt data**: Your purchase history (items, prices, dates) is fetched directly from Costco's API and sent to your WarehouseMeals account.

### What We Store

- **WarehouseMeals API token**: Stored in Chrome's extension storage (`chrome.storage.local`) to keep you logged in. This token can only access your WarehouseMeals account.

### What We Do NOT Do

- ❌ Store Costco credentials or passwords
- ❌ Store Costco session tokens (read fresh each sync)
- ❌ Access your Costco payment methods or personal info
- ❌ Send data anywhere except your WarehouseMeals account
- ❌ Run in the background when not actively syncing
- ❌ Track your browsing activity

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Popup UI   │───▶│  Background  │───▶│  Content Script  │  │
│  │  (popup.js)  │    │ (background) │    │ (costco.js)      │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│         │                   │                     │              │
│         │                   │                     │              │
│         ▼                   ▼                     ▼              │
│    User clicks         Coordinates            Runs on           │
│    "Sync Now"          messages &           costco.com          │
│                        API calls                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      External Services         │
              ├───────────────────────────────┤
              │                               │
              │  costco.com API               │
              │  (receipts only)              │
              │                               │
              │  warehousemeals.com API       │
              │  (your account)               │
              │                               │
              └───────────────────────────────┘
```

### File Structure

```
chrome/
├── manifest.json          # Extension configuration
├── background.js          # Service worker - coordinates everything
├── content/
│   └── costco.js          # Content script - runs on costco.com
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
└── icons/                 # Extension icons
```

### Sync Flow

1. User clicks "Sync Now" in the popup
2. Popup sends message to background script
3. Background script messages the content script on costco.com
4. Content script reads the Costco session token from `localStorage`
5. Content script calls Costco's receipt API (same API the website uses)
6. Receipt data flows back through background script
7. Background script sends receipts to WarehouseMeals API
8. User sees success message

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `storage` | Store your WarehouseMeals login token |
| `identity` | OAuth flow for WarehouseMeals login |
| `tabs` | Find your open costco.com tab |
| `https://www.costco.com/*` | Run content script to read receipts |
| `https://ecom-api.costco.com/*` | Fetch receipt data from Costco API |
| `https://warehousemeals.com/*` | Send receipts to your account |

## Development

### Prerequisites

- Chrome browser
- A WarehouseMeals account

### Installation (Development)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome/` directory

### Testing

1. Sign in to costco.com in a browser tab
2. Click the extension icon
3. Connect your WarehouseMeals account
4. Click "Sync Now"

### Configuration

For local development, update the `CONFIG.warehouseMealsUrl` in `background.js`:

```javascript
const CONFIG = {
  warehouseMealsUrl: 'https://warehousemeals.test', // Local dev
  // warehouseMealsUrl: 'https://warehousemeals.com', // Production
};
```

## Building for Production

1. Update `CONFIG.warehouseMealsUrl` to production URL
2. Update version in `manifest.json`
3. Zip the `chrome/` directory
4. Upload to Chrome Web Store

## Source Code

This extension is open source. You can audit every line of code to verify exactly what it does:

- `background.js` - Service worker that coordinates messages and API calls
- `content/costco.js` - Content script that reads receipts from costco.com
- `popup/popup.js` - UI logic for the extension popup

## Questions?

- **Website**: [warehousemeals.com](https://warehousemeals.com)
- **Issues**: Report bugs or request features on GitHub
