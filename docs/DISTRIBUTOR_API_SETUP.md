# Distributor API Key Setup

Price/stock lookups need **DigiKey** and **Mouser** keys (both free). **LCSC**
has no public API, so it needs no key (unofficial paths only).

Put the issued values in `web/.env.local` (server-only — never exposed to the
client):

```dotenv
DIGIKEY_CLIENT_ID=...
DIGIKEY_CLIENT_SECRET=...
DIGIKEY_USE_SANDBOX=true     # sandbox for connectivity tests; set false for live data
MOUSER_API_KEY=...
```

> The web app runs fine with empty keys (adapters fall back to sandbox/mock).
> Fill them in and restart to switch to live lookups. In production, set the
> same variables in the Vercel project settings.

---

## 1. DigiKey (OAuth2, free)

1. **Register** at <https://developer.digikey.com> and sign in with a DigiKey
   account (create one at digikey.com if needed).
2. **Create an organization** under "My Organizations".
3. **Create an app** inside the organization ("Add App" / Create Production App).
   - **OAuth**: we use the **2-legged `client_credentials`** flow for
     price/stock/barcode, so the Callback/Redirect URL can be anything
     (e.g. `https://localhost`) — it is unused in this flow.
   - **Subscribe to**: **Product Information V4** (search/price/stock), and
     optionally **Barcode**. ⚠️ The MyLists 3rd-party API used for batch buy
     links needs no key, so you don't have to subscribe to it.
4. **Copy credentials**: the app's **Client ID** and **Client Secret** →
   `DIGIKEY_CLIENT_ID` / `DIGIKEY_CLIENT_SECRET`.
5. **Sandbox first**: keep `DIGIKEY_USE_SANDBOX=true` to validate auth/connectivity
   (sandbox returns fixed data, not live stock). Once it works, set `false`.

**Reference**
- Token endpoint: `POST https://api.digikey.com/v1/oauth2/token`
  (sandbox: `https://sandbox-api.digikey.com/...`), `grant_type=client_credentials`,
  ~30 min token lifetime.
- Every request needs two headers: `Authorization: Bearer <token>` +
  `X-DIGIKEY-Client-Id: <client_id>`.
- Rate limit: ~120 req/min, ~1000 req/day (community figures — confirm in your
  portal dashboard). Exceeding returns `429`.
- Docs: <https://developer.digikey.com/products/product-information-v4>

---

## 2. Mouser (API key, free)

1. **Open the API hub** at <https://www.mouser.com/api-hub/> and sign in / sign
   up with a My Mouser account.
2. **Get a Search API key** (issued instantly).
   - Mouser splits **Search** and **Cart/Order** keys. The MVP (price/stock
     lookup) only needs the **Search API key**. (Add a Cart key later if you
     want programmatic batch carts.)
3. **Copy the key** → `MOUSER_API_KEY`.

**Reference**
- Auth: query string `?apiKey=<key>` (not OAuth).
- Search is **POST** `https://api.mouser.com/api/v2/search/keywordandmanufacturer`
  or `/partnumberandmanufacturer` (v1 is deprecated).
- Rate limit: ~30 req/min, 1000 req/day, max 50 results per call.
- No barcode-decode API → the web app parses the DataMatrix locally, then
  searches by MPN.
- Docs: <https://www.mouser.com/api-search/>

---

## 3. LCSC / JLCPCB (no key, unofficial)

- LCSC has **no public customer API**. We use these best-effort:
  - Barcode: parse the reel/bag **QR** `{pc:Cxxxx, pm:<MPN>, qty:<n>}` locally
    (no key). `pc` is the C-number.
  - Search/stock: jlcsearch (community) JSON or EasyEDA C-number lookup —
    **unofficial, reliability not guaranteed**.
- JLCPCB's partner "Components API" exists but is approval-gated (order history),
  not open to general developers.
- Key trick: the QR already contains the **MPN (`pm`)**, so look that MPN up via
  the official DigiKey/Mouser APIs for authoritative price/stock. Mark LCSC-native
  data as "unofficial"; buy via per-part links + CSV export.

---

## Security notes

- Never commit `.env.local` (it is gitignored). For cloud deploys, inject the
  same variables via the **Vercel project environment variables** UI.
- If a key leaks, rotate it immediately in the provider's portal.
