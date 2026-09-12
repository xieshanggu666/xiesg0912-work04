import type { Timbre, WeatherKind } from '../audio/AudioEngine';

/** 格子数量（与 Game.SLOT_COUNT 对应，存档独立保存以校验） */
export interface SongDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  flow: number; // 流速 0~1
  level: number; // 水位 0~1
  weather: WeatherKind;
  slotCount: number;
  /** 格子顺序：每格放的是哪块碎片，null 表示空格 */
  slots: (string | null)[];
  /** 河里所有碎片（不在格子里的也保存，避免丢失录音） */
  fragments: FragmentDoc[];
  version: 1;
}

export interface FragmentDoc {
  id: string;
  kind: 'tone' | 'voice';
  freq: number;
  timbre: Timbre;
  color: string;
  label: string;
  /** tone 碎片在固定音阶中的序号，重新打开时据此恢复波形；voice 为 -1 */
  toneIndex: number;
  /** 仅 voice：原始录音的 base64（webm/opus 或 mp4），声音波形也从中恢复 */
  audio?: string;
  audioMime?: string;
}

export interface SongSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  weather: WeatherKind;
  voiceCount: number;
}

const STORAGE_KEY = 'river-songs-v1';
const DOC_VERSION = 1 as const;
/** localStorage 常见每源上限约 5MB，留余量给其它数据 */
const MAX_TOTAL_BYTES = 4_500_000;

/* ---------- base64：二进制录音 ↔ 字符串（DataURL 拆包，不走 atob 的中文坑） ---------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readStore(): SongDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is SongDoc => !!d && typeof d === 'object' && 'id' in d && 'name' in d);
  } catch {
    return [];
  }
}

function writeStore(docs: SongDoc[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

export class Portfolio {
  /** 作品集列表（按最近修改倒序） */
  list(): SongSummary[] {
    return readStore()
      .map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        weather: d.weather,
        voiceCount: d.fragments.filter((f) => f.kind === 'voice').length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): SongDoc | null {
    return readStore().find((d) => d.id === id) ?? null;
  }

  /** 新建或覆盖同名 id 的作品；空间不足时抛 QuotaError */
  save(doc: Omit<SongDoc, 'version'>): SongDoc {
    const full: SongDoc = { ...doc, version: DOC_VERSION };
    const docs = readStore();
    const i = docs.findIndex((d) => d.id === full.id);
    if (i >= 0) docs[i] = full;
    else docs.unshift(full);

    const json = JSON.stringify(docs);
    if (json.length > MAX_TOTAL_BYTES) throw new QuotaError('作品集空间快满了');
    try {
      writeStore(docs);
    } catch (e) {
      // 多数浏览器配额超限时抛 QuotaExceededError
      throw new QuotaError('存不下啦：录音太多，浏览器本地空间不足', e);
    }
    return full;
  }

  remove(id: string): void {
    writeStore(readStore().filter((d) => d.id !== id));
  }

  /** 新建作品的唯一 id（时间戳 + 随机串，不依赖 crypto） */
  static newId(): string {
    return `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** 本地空间不足（或浏览器拒绝写入），供 UI 给出明确提示 */
export class QuotaError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}
