export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const SENSITIVE_KEYS = new Set([
  "password", "newpassword", "oldpassword", "confirmpassword",
  "token", "accesstoken", "refreshtoken", "apikey", "apisecret",
  "secret", "authorization", "cookie", "sessionid",
  "creditcard", "cardnumber", "cvv", "ssn",
  "totpsecret", "backupcodes", "encryptionkey",
]);

export function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = "***REDACTED***";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function safeLog(label: string, data: unknown, source = "express") {
  const redacted = redactSensitive(data);
  log(`${label}: ${JSON.stringify(redacted)}`, source);
}
