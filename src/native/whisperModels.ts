import RNFS from 'react-native-fs';
import {WHISPER_MODELS, type WhisperModelName} from './whisper';

const MODEL_DIR = `${RNFS.DocumentDirectoryPath}/whisper_models`;

export interface ModelStatus {
  downloaded: boolean;
  path: string | null;
  sizeBytes: number | null;
}

function modelFilePath(name: WhisperModelName): string {
  return `${MODEL_DIR}/${WHISPER_MODELS[name].file}`;
}

export async function getModelStatus(
  name: WhisperModelName,
): Promise<ModelStatus> {
  const path = modelFilePath(name);
  try {
    const stat = await RNFS.stat(path);
    return {downloaded: stat.isFile(), path, sizeBytes: Number(stat.size)};
  } catch {
    return {downloaded: false, path, sizeBytes: null};
  }
}

export async function downloadModel(
  name: WhisperModelName,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const model = WHISPER_MODELS[name];
  const dirExists = await RNFS.exists(MODEL_DIR);
  if (!dirExists) {
    await RNFS.mkdir(MODEL_DIR);
  }
  const destPath = modelFilePath(name);
  const tmpPath = `${destPath}.tmp`;

  const job = RNFS.downloadFile({
    fromUrl: model.url,
    toFile: tmpPath,
    progressInterval: 500,
    progress: res => {
      if (res.contentLength > 0) {
        onProgress?.(Math.round((res.bytesWritten / res.contentLength) * 100));
      }
    },
  });

  try {
    const result = await job.promise;
    if (result.statusCode !== 200) {
      throw new Error(`Download failed with HTTP ${result.statusCode}`);
    }
    const stat = await RNFS.stat(tmpPath);
    if (Number(stat.size) < model.bytes * 0.95) {
      throw new Error(
        `Downloaded file is too small (${stat.size} of ${model.bytes} bytes)`,
      );
    }
    await RNFS.moveFile(tmpPath, destPath);
    return destPath;
  } catch (err) {
    const tmpExists = await RNFS.exists(tmpPath);
    if (tmpExists) {
      await RNFS.unlink(tmpPath);
    }
    throw err;
  }
}

export async function deleteModel(name: WhisperModelName): Promise<void> {
  const path = modelFilePath(name);
  const exists = await RNFS.exists(path);
  if (exists) {
    await RNFS.unlink(path);
  }
}
