# WarehouseMeals Chrome Extension

Sync your Costco receipts to [WarehouseMeals](https://warehousemeals.com) with one click.

## What This Extension Does

1. **Connects to your WarehouseMeals account** via secure OAuth flow
2. **Reads your Costco receipts** from costco.com when you click "Sync"
3. **Sends receipt data to WarehouseMeals** to build your personalized food catalog

## Privacy & Security

This extension is designed with your privacy in mind. It only accesses your Costco receipt data when you click "Sync" and sends it directly to your WarehouseMeals account. No Costco credentials, passwords, or session tokens are ever stored. The only thing saved locally is your WarehouseMeals login token so you stay signed in.

The extension does not access your payment methods or personal info, does not send data anywhere except WarehouseMeals, does not run in the background, and does not track your browsing.

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `storage` | Store your WarehouseMeals login token |
| `identity` | OAuth flow for WarehouseMeals login |
| `tabs` | Find your open costco.com tab |
| `https://www.costco.com/*` | Run content script to read receipts |
| `https://ecom-api.costco.com/*` | Fetch receipt data from Costco API |
| `https://warehousemeals.com/*` | Send receipts to your account |

## Getting Started

1. Install the extension from the Chrome Web Store
2. Sign in to [costco.com](https://www.costco.com) in a browser tab
3. Click the extension icon and connect your WarehouseMeals account
4. Click "Sync Now"

## Source Code

This extension is open source. You can audit every line of code to verify exactly what it does.

## Building

Run `./build.sh` to create a production zip. This swaps the dev domain (`warehousemeals.test`) to `warehousemeals.com` and outputs `build/warehousemeals-chrome.zip`.

## Questions?

- **Website**: [warehousemeals.com](https://warehousemeals.com)
- **Issues**: Report bugs or request features on GitHub
