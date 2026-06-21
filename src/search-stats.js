import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class SearchStatsStore {
  constructor({ filePath = "data/search-stats.json" } = {}) {
    this.filePath = resolve(filePath);
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async recordSearch({ now = new Date() } = {}) {
    const timestamp = normalizeDate(now);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const current = await this.readData();
        const data = {
          ...current,
          daily: { ...current.daily }
        };
        const day = toDayKey(timestamp);

        data.totalSearches += 1;
        data.daily[day] = (data.daily[day] || 0) + 1;
        data.firstSearchAt ||= timestamp.toISOString();
        data.lastSearchAt = timestamp.toISOString();

        await this.writeData(data);
        this.data = data;
      });

    await this.writeQueue;
    return this.getStats({ now: timestamp });
  }

  async getStats({ now = new Date() } = {}) {
    const data = await this.readData();
    return summarizeStats(data, normalizeDate(now));
  }

  async readData() {
    if (this.data) {
      return this.data;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = normalizeData(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      this.data = createEmptyData();
    }

    return this.data;
  }

  async writeData(data) {
    await mkdir(dirname(this.filePath), { recursive: true });

    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}

export function summarizeStats(data, now = new Date()) {
  const current = normalizeDate(now);
  const today = toDayKey(current);
  const recentDays = new Set();

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(current);
    day.setUTCDate(current.getUTCDate() - offset);
    recentDays.add(toDayKey(day));
  }

  const last7DaysSearches = Object.entries(data.daily || {})
    .filter(([day]) => recentDays.has(day))
    .reduce((total, [, count]) => total + count, 0);

  return {
    totalSearches: data.totalSearches || 0,
    todaySearches: data.daily?.[today] || 0,
    last7DaysSearches,
    firstSearchAt: data.firstSearchAt || "",
    lastSearchAt: data.lastSearchAt || ""
  };
}

function createEmptyData() {
  return {
    totalSearches: 0,
    firstSearchAt: "",
    lastSearchAt: "",
    daily: {}
  };
}

function normalizeData(value) {
  return {
    totalSearches: Number.isFinite(value?.totalSearches)
      ? value.totalSearches
      : 0,
    firstSearchAt: value?.firstSearchAt || "",
    lastSearchAt: value?.lastSearchAt || "",
    daily: normalizeDaily(value?.daily)
  };
}

function normalizeDaily(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([day, count]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(count))
      .map(([day, count]) => [day, count])
  );
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function toDayKey(date) {
  return date.toISOString().slice(0, 10);
}
