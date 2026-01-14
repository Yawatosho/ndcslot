// src/modules/ndc.js
// ndc.json を読み込み、有効な3桁コードのキャッシュを構築する

/**
 * @typedef {{ndc:string, subject:string}} NdcRow
 * @typedef {{x:number,y:number,z:number,code:string}} Triple
 */

/**
 * @param {{ jsonUrl: URL | string }} params
 * @returns {Promise<{
 *   index: Map<string,string>,
 *   validAll: Triple[],
 *   validByPage: Triple[][],
 *   isValidCode(code:string): boolean,
 *   isValidCell(x:number,y:number,z:number): boolean,
 *   tripleToCode(x:number,y:number,z:number): string,
 *   getSubject(code:string): (string|null),
 * }>}
 */
export async function initNdc(params) {
  const jsonUrl = params?.jsonUrl;
  if (!jsonUrl) throw new Error("initNdc: jsonUrl is required");

  const res = await fetch(jsonUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ndc.json: ${res.status}`);

  /** @type {NdcRow[]} */
  const list = await res.json();

  const index = new Map(
    list.map((x) => [String(x.ndc).padStart(3, "0"), String(x.subject ?? "")])
  );

  /** @type {Triple[]} */
  const validAll = [];
  /** @type {Triple[][]} */
  const validByPage = Array.from({ length: 10 }, () => []);

  for (const code of index.keys()) {
    const x = Number(code[0]);
    const y = Number(code[1]);
    const z = Number(code[2]);
    if (![x, y, z].every((n) => Number.isInteger(n) && n >= 0 && n <= 9)) continue;

    const t = { x, y, z, code };
    validAll.push(t);
    validByPage[x].push(t);
  }

  function tripleToCode(x, y, z) {
    return `${x}${y}${z}`;
  }
  function isValidCode(code) {
    return index.has(code);
  }
  function isValidCell(x, y, z) {
    return isValidCode(tripleToCode(x, y, z));
  }
  function getSubject(code) {
    return index.get(code) ?? null;
  }

  return { index, validAll, validByPage, isValidCode, isValidCell, tripleToCode, getSubject };
}

/**
 * “自然に見える”よう、baseに近い候補を優先して選ぶ
 * @param {{x:number,y:number,z:number}[]} candidates
 * @param {{x:number,y:number,z:number}} base
 */
export function pickPreferClose(candidates, base) {
  if (candidates.length === 1) return candidates[0];

  const scored = candidates.map((c) => ({
    c,
    score: Math.abs(c.x - base.x) * 3 + Math.abs(c.y - base.y) * 2 + Math.abs(c.z - base.z),
  }));
  scored.sort((a, b) => a.score - b.score);

  const topN = Math.min(12, scored.length);
  return scored[randInt(0, topN - 1)].c;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
