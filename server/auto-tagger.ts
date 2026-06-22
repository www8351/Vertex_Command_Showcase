export function generateAutoTags(entry: {
  openedAt?: Date | string | null;
  closedAt?: Date | string | null;
  realizedPnl?: number | null;
  side?: string | null;
  symbol?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
}): string[] {
  const tags: string[] = [];

  const opened = entry.openedAt ? new Date(entry.openedAt) : null;
  const closed = entry.closedAt ? new Date(entry.closedAt) : null;

  if (opened && closed && !isNaN(opened.getTime()) && !isNaN(closed.getTime())) {
    const durationMs = closed.getTime() - opened.getTime();
    const durationMin = durationMs / (1000 * 60);

    if (durationMin >= 0 && durationMin < 5) {
      tags.push("scalp");
    } else if (durationMin >= 60) {
      tags.push("swing");
    }
  }

  const pnl = entry.realizedPnl || 0;
  if (Math.abs(pnl) > 500) {
    tags.push("breakout");
  }

  if (entry.side && entry.entryPrice && entry.exitPrice) {
    const side = entry.side.toLowerCase();
    const entryP = entry.entryPrice;
    const exitP = entry.exitPrice;
    const isLong = ["buy", "long"].includes(side);

    if ((isLong && exitP < entryP && pnl > 0) || (!isLong && exitP > entryP && pnl > 0)) {
      tags.push("reversal");
    }
  }

  return tags;
}
