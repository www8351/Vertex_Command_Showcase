#!/usr/bin/env bash
set -uo pipefail

AUDIT_OUTPUT_FILE="${1:-/tmp/npm-audit-result.json}"

echo "=== Dependency Vulnerability Scan ==="
echo "Running npm audit --production --audit-level=high ..."

rm -f "$AUDIT_OUTPUT_FILE"

AUDIT_EXIT=0
npm audit --production --audit-level=high --json > "$AUDIT_OUTPUT_FILE" 2>/dev/null || AUDIT_EXIT=$?

if [ ! -s "$AUDIT_OUTPUT_FILE" ]; then
  echo '{"metadata":{"vulnerabilities":{"total":-1,"critical":-1,"high":-1,"moderate":-1,"low":-1,"info":-1}},"error":"npm audit failed to produce output"}' > "$AUDIT_OUTPUT_FILE"
  echo "ERROR: npm audit failed to produce output (exit code: $AUDIT_EXIT)"
  exit 2
fi

if ! jq empty "$AUDIT_OUTPUT_FILE" 2>/dev/null; then
  echo '{"metadata":{"vulnerabilities":{"total":-1,"critical":-1,"high":-1,"moderate":-1,"low":-1,"info":-1}},"error":"npm audit produced invalid JSON"}' > "$AUDIT_OUTPUT_FILE"
  echo "ERROR: npm audit produced invalid JSON"
  exit 2
fi

TOTAL=$(jq '.metadata.vulnerabilities.total // -1' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "-1")
HIGH=$(jq '.metadata.vulnerabilities.high // 0' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "0")
CRITICAL=$(jq '.metadata.vulnerabilities.critical // 0' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "0")
MODERATE=$(jq '.metadata.vulnerabilities.moderate // 0' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "0")
LOW=$(jq '.metadata.vulnerabilities.low // 0' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "0")
INFO=$(jq '.metadata.vulnerabilities.info // 0' "$AUDIT_OUTPUT_FILE" 2>/dev/null || echo "0")

if [ "$TOTAL" -eq -1 ]; then
  echo "ERROR: Could not parse vulnerability counts from audit output"
  exit 2
fi

echo ""
echo "=== Audit Summary ==="
echo "Total vulnerabilities: $TOTAL"
echo "  Critical: $CRITICAL"
echo "  High:     $HIGH"
echo "  Moderate: $MODERATE"
echo "  Low:      $LOW"
echo "  Info:     $INFO"
echo ""

if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
  echo "⚠ HIGH/CRITICAL vulnerabilities found! Review recommended."
  exit 1
elif [ "$TOTAL" -gt 0 ]; then
  echo "⚡ Some low/moderate vulnerabilities found."
  exit 0
else
  echo "✓ No known vulnerabilities found."
  exit 0
fi
