import { google } from "googleapis";

const required = [
  "APG_MERCHANT_ID",
  "APG_STORE_ID",
  "APG_MERCHANT_HASH",
  "APG_MERCHANT_USERNAME",
  "APG_MERCHANT_PASSWORD",
  "APG_KEY1",
  "APG_KEY2",
  "APG_SANDBOX_BASE"
];
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
if (!clientId || !clientSecret || !refreshToken) {
  throw new Error("Missing Google OAuth client or refresh-token secret.");
}

const auth = new google.auth.OAuth2(clientId, clientSecret);
auth.setCredentials({ refresh_token: refreshToken });
await auth.getAccessToken();
const api = google.script({ version: "v1", auth });
const deploymentId = process.env.APPS_SCRIPT_API_DEPLOYMENT_ID;
if (!deploymentId) throw new Error("Missing Apps Script API deployment ID.");
const statusOnly = process.argv.includes("--status-only");
const payload = statusOnly ? undefined : Object.fromEntries(required.map(name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing GitHub secret ${name}.`);
  return [name, value];
}));

let response;
try {
  response = await api.scripts.run({
    scriptId: deploymentId,
    requestBody: {
      function: statusOnly ? "apgConfigStatus" : "syncApgScriptProperties",
      ...(statusOnly ? {} : { parameters: [payload] })
    }
  });
} catch (error) {
  const status = error.response?.data?.error?.status || error.response?.status || "UNKNOWN";
  throw new Error(`Apps Script execution request failed: ${status}`);
}
const executionError = response.data.response?.error;
if (executionError) {
  throw new Error(`Apps Script execution failed: ${executionError.errorMessage || executionError.type || "unknown error"}`);
}
const result = response.data.response?.result;
if (statusOnly) {
  if (!result?.ok || !result.present) throw new Error("Apps Script status returned no valid presence-only result.");
  console.log("harmless scripts.run=ok");
  process.exit(0);
}
if (!result?.ok || !result.present) throw new Error("Apps Script sync returned no valid presence-only result.");
for (const name of required) console.log(`${name}=${result.present[name] === true}`);
