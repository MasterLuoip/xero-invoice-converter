# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GitHub Pages static site that converts POS (point-of-sale) order CSVs into Xero-compatible Sales Invoice import CSVs. No build step — plain HTML/CSS/JS served directly.

## Architecture

- `index.html` — single page UI with two file upload inputs (POS CSV + Xero Items CSV) and a convert button
- `style.css` — styling
- `converter.js` — all conversion logic:
  - `parseCSV()` / `rowsToObjects()` — CSV parsing (handles quoted fields)
  - `parsePOSOrders()` — groups POS rows into orders (IN-STORE header + Item rows)
  - `buildXeroItemsLookup()` — builds a Map from normalized ItemName → item details
  - `matchProduct()` — matches POS product names to Xero items (exact then substring)
  - `convert()` — main orchestrator: matches products, merges quantities, validates
  - `generateCSV()` — outputs Xero Sales Invoice CSV format

## Key Business Rules

- Store names map to specific Xero ContactNames (case-insensitive)
- Prices come from Xero Items `SalesUnitPrice`, never from POS
- `AccountCode` and `TaxType` come from Xero Items per-product (not hardcoded)
- Same InventoryItemCode within one invoice must be merged (qty summed)
- Invoice number format: `{STORE_CODE}-{YYYYMMDD}-{OrderNumber}`
- Items missing Xero fields are excluded and flagged as warnings

## Development

Open `index.html` in a browser — no server or build needed. For local dev with live reload:

```
npx serve .
```

## Deployment

Push to `main` branch with GitHub Pages configured to serve from root (`/`).
