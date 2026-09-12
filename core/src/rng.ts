/**
 * 确定性随机数发生器（mulberry32）
 *
 * 铁律：core 内**禁止使用 Math.random()**。
 * 所有随机都必须走这里，否则 golden replay 无法复现。
 */

export interface Rng {
  getState(): number;
  setState(v: number): void;
  next(): number;
  int(n: number): number;
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[];
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    getState: () => s,
    setState: (v: number) => { s = v >>> 0; },
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(arr: T[]): T => arr[Math.floor(next() * arr.length)] as T,
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i] as T;
        arr[i] = arr[j] as T;
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

/** 由字符串生成稳定种子（卡组 id、对局 id 等） */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
