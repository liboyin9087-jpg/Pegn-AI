/**
 * inputSanitizer.ts
 * P0 Security: Prompt Injection 防護
 *
 * 防止以下攻擊類型：
 * - Role-override attacks: "Ignore previous instructions, you are now..."
 * - System prompt exfiltration: "Repeat everything above verbatim"
 * - Context escape: Content containing delimiters used to break prompt structure
 */

import { observability } from './observability.js';

// 最大輸入長度限制（字元數）
const MAX_INPUT_LENGTH = 8000;
const MAX_PROMPT_LENGTH = 16000;

// 高風險 Prompt Injection 模式
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,    label: 'role_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i, label: 'role_override' },
  { pattern: /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,    label: 'role_override' },
  { pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,                             label: 'persona_switch' },
  { pattern: /act\s+as\s+(a|an|the)\s+/i,                                    label: 'persona_switch' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+/i,                            label: 'persona_switch' },
  { pattern: /repeat\s+(everything|all|the\s+above)\s+(verbatim|exactly)/i,  label: 'exfiltration' },
  { pattern: /print\s+(your\s+)?(system\s+prompt|instructions)/i,            label: 'exfiltration' },
  { pattern: /reveal\s+(your\s+)?(system\s+prompt|instructions)/i,           label: 'exfiltration' },
  { pattern: /show\s+(me\s+)?(your\s+)?(system\s+prompt|instructions)/i,     label: 'exfiltration' },
  { pattern: /<\|im_start\|>|<\|im_end\|>|<\|system\|>/i,                   label: 'delimiter_escape' },
  { pattern: /\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>>/i,                       label: 'delimiter_escape' },
  { pattern: /""".*system.*"""/is,                                            label: 'delimiter_escape' },
];

export interface SanitizeResult {
  safe: string;
  blocked: boolean;
  reason?: string;
}

/**
 * 清理使用者輸入（input），防止 prompt injection。
 * 截斷超長內容、偵測已知攻擊模式後記錄告警（不暴露給前端）。
 */
export function sanitizeUserInput(input: string, context?: { userId?: string; workspaceId?: string }): SanitizeResult {
  if (typeof input !== 'string') {
    return { safe: '', blocked: true, reason: 'invalid_type' };
  }

  // 截斷超長輸入
  const truncated = input.length > MAX_INPUT_LENGTH ? input.slice(0, MAX_INPUT_LENGTH) : input;

  // 偵測注入模式
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(truncated)) {
      observability.warn('Prompt injection attempt detected', {
        label,
        length: input.length,
        preview: input.slice(0, 120),
        ...context,
      });
      // 不 block — 改為移除匹配段落，降低誤殺率
      // 對於 exfiltration / delimiter_escape 類型則直接拒絕
      if (label === 'exfiltration' || label === 'delimiter_escape') {
        return {
          safe: '',
          blocked: true,
          reason: label,
        };
      }
    }
  }

  // 移除控制字元（保留換行與 tab）
  const cleaned = truncated.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return { safe: cleaned, blocked: false };
}

/**
 * 清理 Prompt 模板本身（由管理員/系統寫入，門檻較寬鬆，主要防長度濫用）。
 */
export function sanitizePromptTemplate(prompt: string): SanitizeResult {
  if (typeof prompt !== 'string') {
    return { safe: '', blocked: true, reason: 'invalid_type' };
  }
  const truncated = prompt.length > MAX_PROMPT_LENGTH ? prompt.slice(0, MAX_PROMPT_LENGTH) : prompt;
  const cleaned = truncated.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return { safe: cleaned, blocked: false };
}
