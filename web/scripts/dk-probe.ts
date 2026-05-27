/**
 * Diagnose the DigiKey adapter without exposing secrets. Prints which env vars
 * are present (as booleans), the resolved API base, the OAuth token HTTP status,
 * and a live search result. Run: npm run dk:probe
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const hasId = Boolean(process.env.DIGIKEY_CLIENT_ID);
const hasSecret = Boolean(process.env.DIGIKEY_CLIENT_SECRET);
const sandboxFlag = process.env.DIGIKEY_USE_SANDBOX;
const base =
  sandboxFlag === "false" ? "https://api.digikey.com" : "https://sandbox-api.digikey.com";

async function main() {
  console.log("DIGIKEY_CLIENT_ID present:", hasId);
  console.log("DIGIKEY_CLIENT_SECRET present:", hasSecret);
  console.log("DIGIKEY_USE_SANDBOX =", JSON.stringify(sandboxFlag), "->  base:", base);
  if (!hasId || !hasSecret) {
    console.log("\nMissing client id/secret in web/.env.local — stop here.");
    return;
  }

  // 1) OAuth token
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DIGIKEY_CLIENT_ID ?? "",
      client_secret: process.env.DIGIKEY_CLIENT_SECRET ?? "",
    }),
  });
  const tokenBody = await tokenRes.text();
  console.log("\nTOKEN status:", tokenRes.status, tokenRes.ok ? "OK" : "FAIL");
  if (!tokenRes.ok) {
    console.log("TOKEN body (first 300):", tokenBody.slice(0, 300));
    console.log(
      "\n=> Token failed. Almost always: keys belong to the OTHER environment than `base` above" +
        " (production keys + sandbox base, or vice-versa). Set DIGIKEY_USE_SANDBOX=false for production keys.",
    );
    return;
  }
  const token = (JSON.parse(tokenBody) as { access_token: string }).access_token;

  // 2) Keyword search
  const q = process.argv[2] ?? "RC0402FR-0710KL";
  const searchRes = await fetch(`${base}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "X-DIGIKEY-Client-Id": process.env.DIGIKEY_CLIENT_ID ?? "",
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ Keywords: q, Limit: 3 }),
  });
  const searchBody = await searchRes.text();
  console.log(`\nSEARCH '${q}' status:`, searchRes.status, searchRes.ok ? "OK" : "FAIL");
  if (!searchRes.ok) {
    console.log("SEARCH body (first 400):", searchBody.slice(0, 400));
    return;
  }
  const json = JSON.parse(searchBody) as {
    ProductsCount?: number;
    Products?: { ManufacturerProductNumber?: string; Category?: { Name?: string } }[];
  };
  console.log("ProductsCount:", json.ProductsCount);
  console.log(
    "first product:",
    json.Products?.[0]?.ManufacturerProductNumber,
    "| category:",
    json.Products?.[0]?.Category?.Name,
  );
}

main().catch((e) => {
  console.error("PROBE ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
