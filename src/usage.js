import fs from 'node:fs';
import path from 'node:path';

/**
 * 사이클별 사용량 계측.
 *
 * 토큰을 하나로 합치지 않는 이유: Anthropic 은 `input_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens` 를 **별개 카운터**로 준다. 단가가 다르고 서로 포함 관계가 아니다.
 * 하나로 더하면 "입력 토큰"이라는 숫자가 실제 요금과도, 컨텍스트 크기와도 맞지 않게 된다.
 */

/** 에이전트별: 계측을 켜는 인자 + 출력 파서. 지원하지 않는 에이전트는 여기에 없다. */
export const USAGE_SUPPORT = {
  claude: {
    // JSON 한 덩어리로 받는다 → 실시간 스트리밍 출력은 포기한다.
    args: ({ budgetRemaining }) => [
      '--output-format',
      'json',
      ...(budgetRemaining != null ? ['--max-budget-usd', String(Math.max(0.01, budgetRemaining).toFixed(2))] : []),
    ],
    parse: parseClaudeJson,
  },
  codex: {
    args: () => ['--json'],
    parse: parseCodexJsonl,
  },
};

export const supportsUsage = (agent) => Boolean(USAGE_SUPPORT[agent]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function parseClaudeJson(out) {
  const start = out.indexOf('{');
  if (start === -1) return null;
  let d;
  try {
    d = JSON.parse(out.slice(start));
  } catch {
    return null;
  }
  const u = d.usage || {};
  return {
    cost_usd: num(d.total_cost_usd) || null,
    turns: num(d.num_turns) || null,
    api_ms: num(d.duration_ms) || null,
    input_tokens: num(u.input_tokens),
    cache_creation_tokens: num(u.cache_creation_input_tokens),
    cache_read_tokens: num(u.cache_read_input_tokens),
    output_tokens: num(u.output_tokens),
    models: Object.keys(d.modelUsage || {}),
    text: typeof d.result === 'string' ? d.result : null,
  };
}

/**
 * Codex 는 JSONL 이벤트를 흘린다. 이벤트 이름이 버전마다 달라서 키 이름으로 찾는다.
 * 실제 Codex 출력으로 검증하지 못했다 — 못 찾으면 조용히 null 을 돌려주고 기록만 건너뛴다.
 */
function parseCodexJsonl(out) {
  const acc = { input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  let found = false;
  let cost = null;
  const texts = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      continue;
    }
    const u = e.usage || e.token_usage || (e.msg && (e.msg.usage || e.msg.token_usage));
    if (u && typeof u === 'object') {
      found = true;
      acc.input_tokens += num(u.input_tokens ?? u.prompt_tokens);
      acc.cache_read_tokens += num(u.cached_input_tokens ?? u.cache_read_input_tokens);
      acc.cache_creation_tokens += num(u.cache_creation_input_tokens);
      acc.output_tokens += num(u.output_tokens ?? u.completion_tokens);
    }
    if (e.total_cost_usd != null) cost = num(e.total_cost_usd);
    const msg = e.last_agent_message ?? (e.msg && e.msg.message);
    if (typeof msg === 'string') texts.push(msg);
  }
  if (!found && !texts.length) return null;
  return { ...acc, cost_usd: cost, turns: null, api_ms: null, models: [], text: texts.pop() || null };
}

const FILE = 'USAGE.jsonl';
export const usagePath = (root, loopDir) => path.join(root, loopDir, FILE);

export function appendUsage(root, loopDir, record) {
  const abs = usagePath(root, loopDir);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify(record) + '\n');
}

export function readUsage(root, loopDir) {
  let raw;
  try {
    raw = fs.readFileSync(usagePath(root, loopDir), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function summarize(rows) {
  const t = {
    cycles: rows.length,
    cost_usd: 0,
    input_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    output_tokens: 0,
    duration_s: 0,
    turns: 0,
    byStatus: {},
  };
  for (const r of rows) {
    t.cost_usd += num(r.cost_usd);
    t.input_tokens += num(r.input_tokens);
    t.cache_creation_tokens += num(r.cache_creation_tokens);
    t.cache_read_tokens += num(r.cache_read_tokens);
    t.output_tokens += num(r.output_tokens);
    t.duration_s += num(r.duration_s);
    t.turns += num(r.turns);
    const k = r.status || 'unknown';
    t.byStatus[k] = (t.byStatus[k] || 0) + 1;
  }
  return t;
}

export const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
