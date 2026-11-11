const RNFSModule = require('react-native-fs');
const RNFS = RNFSModule.default ?? RNFSModule;

const HISTORY_FILE = `${RNFS.DocumentDirectoryPath}/history.json`;
const MAX_ENTRIES = 30;

export interface HistoryEntry {
  id: string;
  videoName: string;
  videoUri: string;
  sourceUrl: string | null;
  document: string;
  savedAt: number; // epoch ms
}

let _cache: HistoryEntry[] | null = null;

async function load(): Promise<HistoryEntry[]> {
  if (_cache) return _cache;
  try {
    const exists = await RNFS.exists(HISTORY_FILE);
    if (!exists) {
      _cache = [];
      return _cache;
    }
    const raw = await RNFS.readFile(HISTORY_FILE, 'utf8');
    _cache = JSON.parse(raw);
    if (!Array.isArray(_cache)) _cache = [];
  } catch {
    _cache = [];
  }
  return _cache;
}

async function save(entries: HistoryEntry[]) {
  _cache = entries.slice(0, MAX_ENTRIES);
  await RNFS.writeFile(HISTORY_FILE, JSON.stringify(_cache), 'utf8');
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return load();
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const entries = (await load()).filter(
    e => e.id !== entry.id && !(e.videoName === entry.videoName && e.sourceUrl === entry.sourceUrl),
  );
  await save([entry, ...entries]);
}

export async function removeHistoryEntry(id: string): Promise<void> {
  const entries = await load();
  const next = entries.filter(e => e.id !== id);
  if (next.length !== entries.length) {
    await save(next);
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await RNFS.unlink(HISTORY_FILE);
  } catch {
    // nothing to clear
  }
  _cache = [];
}
