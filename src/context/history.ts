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
  thumbnailPath: string | null;
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
  // Thumbnails live in the shared cache dir; copy each one into a
  // history-owned folder so clearing the app cache never blanks the list.
  if (entry.thumbnailPath) {
    try {
      const dir = `${RNFS.DocumentDirectoryPath}/history_thumbs`;
      if (!(await RNFS.exists(dir))) {
        await RNFS.mkdir(dir);
      }
      const dest = `${dir}/${entry.id}.jpg`;
      if (await RNFS.exists(entry.thumbnailPath.replace('file://', ''))) {
        await RNFS.copyFile(entry.thumbnailPath.replace('file://', ''), dest);
        entry = {...entry, thumbnailPath: dest};
      }
    } catch {
      entry = {...entry, thumbnailPath: null};
    }
  }
  const entries = (await load()).filter(
    e => e.id !== entry.id && !(e.videoName === entry.videoName && e.sourceUrl === entry.sourceUrl),
  );
  await save([entry, ...entries]);
}

export async function removeHistoryEntry(id: string): Promise<void> {
  const entries = await load();
  const victim = entries.find(e => e.id === id);
  if (victim?.thumbnailPath) {
    try {
      if (await RNFS.exists(victim.thumbnailPath)) {
        await RNFS.unlink(victim.thumbnailPath);
      }
    } catch {
      // thumbnail already gone; still remove the entry
    }
  }
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
