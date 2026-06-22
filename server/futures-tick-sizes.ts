const TICK_SIZE_MAP: Record<string, number> = {
  "ES": 0.25,
  "NQ": 0.25,
  "YM": 1.0,
  "RTY": 0.10,
  "MES": 0.25,
  "MNQ": 0.25,
  "MYM": 1.0,
  "M2K": 0.10,
  "CL": 0.01,
  "MCL": 0.01,
  "GC": 0.10,
  "MGC": 0.10,
  "SI": 0.005,
  "SIL": 0.005,
  "HG": 0.0005,
  "NG": 0.001,
  "ZB": 1 / 32,
  "ZN": 1 / 64,
  "ZF": 1 / 128,
  "ZT": 1 / 256,
  "6E": 0.00005,
  "6J": 0.0000005,
  "6B": 0.0001,
  "6A": 0.0001,
  "6C": 0.00005,
  "6S": 0.0001,
  "ZC": 0.25,
  "ZS": 0.25,
  "ZW": 0.25,
  "ZL": 0.01,
  "ZM": 0.10,
  "HE": 0.025,
  "LE": 0.025,
  "EMD": 0.10,
  "NKD": 5.0,
  "VX": 0.05,
};

export function getTickSize(symbol: string): number {
  const normalized = symbol.replace(/[A-Z]{2,3}\d{2}$/i, "").replace(/\s+/g, "").toUpperCase();

  if (TICK_SIZE_MAP[normalized]) return TICK_SIZE_MAP[normalized];

  for (const [key, value] of Object.entries(TICK_SIZE_MAP)) {
    if (normalized.startsWith(key) || normalized.includes(key)) {
      return value;
    }
  }

  const parts = symbol.split(/[.\-@]/);
  for (const part of parts) {
    const clean = part.replace(/\d+$/g, "").toUpperCase();
    if (TICK_SIZE_MAP[clean]) return TICK_SIZE_MAP[clean];
  }

  return 0.25;
}

export function getTickSizeFromContractId(contractId: string): number {
  const parts = contractId.split(/[@.]/);
  for (const part of parts) {
    const size = getTickSize(part);
    if (size !== 0.25 || TICK_SIZE_MAP[part.replace(/\d+$/g, "").toUpperCase()]) {
      return size;
    }
  }
  return getTickSize(contractId);
}
