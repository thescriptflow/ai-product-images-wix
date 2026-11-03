# AI Product Images

Dashboard app for Wix Stores merchants. It lists catalog products, opens a product editor, and previews AI photo actions: background removal, background replacement, lifestyle scenes, before/after compare, and batch apply. Publishing a generated photo to the store, real model calls, and credit billing are stubbed.

The project uses the current [Wix CLI](https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli) app layout: React, TypeScript, Astro, and `@wix/design-system`. It was started from the official blank app template (`astro-app-template` in [wix/cli-app-templates](https://github.com/wix/cli-app-templates)). `npm create @wix/new app` and `wix generate` both require a logged-in Wix account, so the dashboard page and HTTP endpoint were written to match the CLI templates shipped with `@wix/cli` 1.2.8.

## What is included

- Dashboard page **AI Product Images** at route `product-images`.
- Product list from `@wix/stores`, with catalog version detection for Stores V1 and V3.
- Product editor that saves name, visibility, and description through the matching catalog API.
- Photo studio actions: **Remove background**, **Replace background**, **AI scene**, **Publish**, plus a before/after preview.
- Batch **AI scene** on the products you select in the table.
- Credits badge. The balance starts at 40 and lives in the dev server process. It resets when the process restarts.
- HTTP endpoint `POST /api/image-processing` and `GET /api/image-processing`.
- Provider interface for `mock` (default), `fal`, `replicate`, and `photoroom`. Keys are read from the environment. No vendor request is sent.

## Prerequisites

- [Node.js](https://nodejs.org/) 24.22.1 or newer (see `.nvmrc`)
- npm
- A Wix account

## Install

```bash
npm install
```

Check types without a Wix login:

```bash
npm run typecheck
```

`npm run build` needs `WIX_CLIENT_ID` in the environment. `npx wix env pull` writes the real value after the app is linked. Before that, the placeholder in `wix.config.json` is enough to compile:

```bash
WIX_CLIENT_ID=00000000-0000-4000-8000-000000000001 npm run build
```

## 1. Create the app in the Wix Dev Center

This step needs your Wix login.

1. Open [Custom Apps](https://manage.wix.com/account/custom-apps).
2. Create an app named **AI Product Images**.
3. Copy the app ID.

You can also let the CLI register the app. From an empty parent folder, while logged in:

```bash
npm create @wix/new@latest -- app --app-name "AI Product Images" --template 24493a0d-18f2-4f68-b6d5-55992cef7daa
```

That command creates a new app in your account and writes `wix.config.json`. This repository already contains the app code, so prefer creating the app in the Dev Center and linking it with the placeholder below. The unified CLI does not have a `wix app` command. That command belonged to the deprecated Wix CLI for Apps.

## 2. Link this project to the app

`wix.config.json` currently holds a placeholder app ID:

```json
"appId": "00000000-0000-4000-8000-000000000001"
```

Replace that value with the app ID from the Dev Center. Leave `projectType` as `App`.

Log in from this folder:

```bash
npx wix login
```

## 3. Permissions

In the app dashboard, open `https://manage.wix.com/apps/<appId>/home`, then **Develop > Permissions > Add Permissions**. Add every scope below. The page reads and updates products on both catalog versions, and a later publish step imports the new photo through Media Manager.

| Why | Scope |
| --- | --- |
| Detect Stores catalog version | `SCOPE.STORES.CATALOG_READ_LIMITED` |
| Read products on a classic (V1) catalog | `SCOPE.DC-STORES.READ-PRODUCTS` |
| Create and update products on a classic catalog | `SCOPE.DC-STORES.MANAGE-PRODUCTS` |
| Read products on the current (V3) catalog | `SCOPE.STORES.PRODUCT_READ` |
| Read hidden products and merchant fields on V3 | `SCOPE.STORES.PRODUCT_READ_ADMIN` |
| Update products on V3 | `SCOPE.STORES.PRODUCT_WRITE` |
| Import a generated photo into Media Manager | `SCOPE.DC-MEDIA.MANAGE-MEDIAMANAGER` |

After you save permissions, install or update the app on the test site and accept the new consent. Hidden products stay out of the list until the admin read scope is granted. On a classic catalog, Query Products also omits hidden products unless `includeHiddenProducts` is set, and the typed query builder this app uses does not expose that flag.

## 4. Provider keys

Copy the example file and leave the provider on `mock` until you have a key:

```bash
cp .env.example .env.local
```

`.env.local` is not committed. To store a value for collaborators on Wix's servers instead:

```bash
npx wix env set --key IMAGE_PROVIDER --value mock
npx wix env pull
```

| Variable | Provider |
| --- | --- |
| `IMAGE_PROVIDER` | `mock` (default), `fal`, `replicate`, or `photoroom` |
| `FAL_KEY` or `FAL_API_KEY` | fal |
| `REPLICATE_API_TOKEN` | Replicate |
| `PHOTOROOM_API_KEY` | Photoroom |

A missing key, or a key that is present, still returns a mock preview. The response says which key was missing or found. Live model HTTP calls are the fashion-model step on the roadmap.

## 5. Run it on a test site

`wix dev` needs a development site. In a non-interactive session, choose one first:

```bash
npx wix dev-site list
npx wix dev-site create
npx wix dev
```

`wix dev` serves the local app (port 4321 unless you pass `--port`) and prints a link to the test site dashboard. Open **AI Product Images** under Apps.

The dev server, test site, and app install all require the Wix login from step 2. Typecheck does not. The production build needs `WIX_CLIENT_ID`, as shown under Install.

## Scripts

| Script | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |
| Preview version | `npm run preview` |
| Release | `npm run release` |

## Project map

```text
src/extensions.ts
src/extensions/dashboard/BusinessManagerTheme.tsx
src/extensions/dashboard/pages/product-images/
src/pages/api/image-processing.ts
src/image-processing/
```

`src/image-processing/providers.ts` is the seam for a real fal, Replicate, or Photoroom call. `process` on those providers is where the model request goes.

## Roadmap

1. **MVP (this repo).** Product list, editor, preview actions, before/after, batch scene preview, credits counter, and the provider interface.
2. **Credits and billing.** Persist the balance per site, charge a credit per successful image, and sell packs through Wix app billing.
3. **AI models for fashion.** Call fal, Replicate, or Photoroom for on-model and ghost-mannequin shots, then import the file with Media Manager and set it as the product's main photo.
