/**
 * agent-templates.ts — Agent 模板策略 DSL 與配置化
 * ──────────────────────────────────────────────────
 * 將所有 Agent 模板的硬編碼提示詞、fallback 任務、
 * 分析員指示等抽離成可設定的 Registry，避免散落在 agent.ts 中。
 *
 * 使用方式：
 *   import { getAgentTemplate, AGENT_TEMPLATE_REGISTRY } from './agent-templates.js';
 *   const tmpl = getAgentTemplate('brainstorm');
 *   const fallback = tmpl.fallbackTasks('我的查詢');
 */

export type AgentTemplateId =
  | 'supervisor'
  | 'research'
  | 'summarize'
  | 'brainstorm'
  | 'outline';

// ── DSL 介面 ───────────────────────────────────────────────────────────────

export interface AgentTemplateConfig {
  /** 模板唯一識別 */
  id: AgentTemplateId;
  /** 使用者可見的顯示名稱 */
  name: string;
  /** 模板用途說明 */
  description: string;
  /**
   * Planner Worker 的 system prompt 工廠。
   * 接收使用者 query，回傳給 LLM 的 prompt 字串。
   */
  plannerPrompt: (query: string) => string;
  /**
   * 當 LLM 不可用（無 API key 或超時）時的 fallback 任務清單。
   * 接收 query，回傳字串陣列（最多 4 個）。
   */
  fallbackTasks: (query: string) => string[];
  /**
   * Writer Worker 的 system/base instruction（短字串，附加在 prompt 前段）。
   */
  writerInstruction: string;
  /**
   * Analyst Worker 的輔助說明（讓分析員根據模板目標調整摘要方式）。
   * 若為 undefined 每則使用通用 analyst prompt。
   */
  analystHint?: string;
}

// ── Template Registry ─────────────────────────────────────────────────────

export const AGENT_TEMPLATE_REGISTRY: Record<AgentTemplateId, AgentTemplateConfig> = {
  supervisor: {
    id: 'supervisor',
    name: '通用 Supervisor',
    description: '以監督者模式協調多個 Worker，適合需要多角度研究的複雜問題。',
    plannerPrompt: (query) => `你是任務規劃器。請把使用者需求拆成 2-4 個可執行子任務，回傳 JSON：{"intent":"...","tasks":["...",...]}
Template: supervisor
User query: ${query}`,
    fallbackTasks: (query) => [
      `界定問題範圍：${query}`,
      '收集與問題直接相關的證據與來源',
      '整合證據並輸出可執行結論',
    ],
    writerInstruction: '請輸出結構化答案，包含重點與可執行建議。',
    analystHint: '請整理各 Worker 的關鍵洞察，並指出結論之間的一致性與矛盾點。',
  },

  research: {
    id: 'research',
    name: '深度研究',
    description: '針對特定主題進行多輪深度資料收集，產出引用完整的研究報告。',
    plannerPrompt: (query) => `你是研究型任務規劃器。請把使用者研究需求拆成 2-4 個子研究問題，每個問題都應聚焦在不同的資訊面向。
回傳 JSON：{"intent":"...","tasks":["...",...]}
特別注意：優先分解成「現況 / 趨勢 / 比較 / 建議」四個面向。
User query: ${query}`,
    fallbackTasks: (query) => [
      `現況分析：${query}`,
      '歷史趨勢與演進',
      '不同觀點與方案比較',
      '結論與建議',
    ],
    writerInstruction: '請輸出學術報告格式的研究摘要，含引用標記 [N] 和參考來源列表。',
    analystHint: '請對多份來源進行交叉驗證，標示高可信度與存疑的資訊。',
  },

  summarize: {
    id: 'summarize',
    name: '精簡摘要',
    description: '將文件或資訊壓縮為重點摘要，突出可執行結論。',
    plannerPrompt: (query) => `你是摘要規劃器。請把待摘要的內容拆成 2-3 個核心主題，回傳 JSON：{"intent":"...","tasks":["...",...]}
規則：任務應涵蓋「主要論點 / 關鍵數據 / 結論與行動建議」。
User query: ${query}`,
    fallbackTasks: (_query) => [
      '抽取重點主題',
      '壓縮內容為精簡摘要',
      '整理可執行結論',
    ],
    writerInstruction: '請輸出精簡摘要與行動重點。使用條列式，每條不超過 2 行。',
    analystHint: '請以「關鍵發現 → 數據支撐 → 建議行動」的三段結構整理。',
  },

  brainstorm: {
    id: 'brainstorm',
    name: '腦力激盪',
    description: '圍繞主題多角度發散思考，產出多元且具創意的想法清單。',
    plannerPrompt: (query) => `你是創意發散規劃器。請把主題從 2-4 個不同視角切入，回傳 JSON：{"intent":"...","tasks":["...",...]}
視角可包含：技術可行性、使用者需求、商業模式、社會影響等。
User query: ${query}`,
    fallbackTasks: (query) => [
      `從不同角度拆解主題：${query}`,
      '發散思考：列出非顯而易見的創意方向',
      '歸納並評估各想法的可行性與潛力',
    ],
    writerInstruction: '請輸出多角度創意想法，以發散思考為主，條列各方向及其潛力。',
    analystHint: '請依「新穎度 × 可行性」矩陣評估各想法，並標示高潛力選項。',
  },

  outline: {
    id: 'outline',
    name: '結構化大綱',
    description: '將主題展開為清晰的章節大綱，每個章節附帶內容提示。',
    plannerPrompt: (query) => `你是大綱規劃器。請把主題分解成 3-5 個主章節，每章節再分 2-3 個小節。
回傳 JSON：{"intent":"...","tasks":["...",...]}（tasks 對應各主章節）
規則：大綱應具備邏輯遞進關係（背景 → 核心內容 → 應用 → 結論）。
User query: ${query}`,
    fallbackTasks: (query) => [
      `分析主題核心架構：${query}`,
      '規劃層次化大綱（章節 / 小節 / 要點）',
      '補充每個章節的關鍵內容提示',
    ],
    writerInstruction: '請輸出層次清晰的結構化大綱，包含章節標題與各章節的核心要點提示。',
    analystHint: '請確認各章節之間邏輯順暢，並補充每章的「讀者收穫」摘要。',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * 取得模板設定，若 id 不存在則回退到 supervisor 模板。
 */
export function getAgentTemplate(id: string): AgentTemplateConfig {
  return AGENT_TEMPLATE_REGISTRY[id as AgentTemplateId] ?? AGENT_TEMPLATE_REGISTRY.supervisor;
}

/**
 * 列出所有可用模板（供 API 端點回傳給前端使用）。
 */
export function listAgentTemplates(): Array<Pick<AgentTemplateConfig, 'id' | 'name' | 'description'>> {
  return Object.values(AGENT_TEMPLATE_REGISTRY).map(({ id, name, description }) => ({ id, name, description }));
}
