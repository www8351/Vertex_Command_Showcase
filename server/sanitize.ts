import type { Response } from "express";

export function safeErrorResponse(
  res: Response,
  err: unknown,
  statusCode: number = 500,
  userMessage: string = "שגיאה פנימית",
): void {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[Error] ${userMessage}:`, error.message, error.stack || "");
  res.status(statusCode).json({ message: userMessage });
}

export function sanitizeString(value: string): string {
  let result = value;
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  result = result.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g, "");
  return result;
}

export function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = sanitizeValue(obj[key]);
  }
  return result as T;
}

const CSV_FORMULA_PREFIXES = ["=", "+", "@", "|", "\t", "\r", "\n"];

export function sanitizeCsvCell(value: string): string;
export function sanitizeCsvCell(value: unknown): unknown;
export function sanitizeCsvCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;

  const firstChar = value[0];

  if (firstChar === "\t" || firstChar === "\r" || firstChar === "\n") {
    return "'" + value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return value;

  if (trimmed.startsWith("-")) {
    const withoutMinus = trimmed.slice(1).replace(/[$,\s]/g, "");
    if (/^\d+(\.\d+)?%?$/.test(withoutMinus)) {
      return value;
    }
    return "'" + value;
  }

  for (const prefix of CSV_FORMULA_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return "'" + value;
    }
  }

  return value;
}

export function sanitizeCsvRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    result[key] = sanitizeCsvCell(val);
  }
  return result;
}
