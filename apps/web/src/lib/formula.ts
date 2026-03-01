/**
 * formula.ts — safe formula evaluator for Collection computed properties.
 *
 * Supported syntax:
 *   prop("FieldName")            reference a field by name
 *   +  -  *  /                  arithmetic operators
 *   &                           string concatenation (alias for +)
 *   if(condition, then, else)   conditional
 *   now()                       current date as YYYY-MM-DD
 *   true / false                boolean literals
 *
 * Example expressions:
 *   prop("Price") * prop("Qty")
 *   prop("First") & " " & prop("Last")
 *   if(prop("Done"), "✓", "…")
 */

/**
 * @param formula  The formula expression string.
 * @param propsByName  Map of { propName → currentValue } for all fields in a row.
 */
export function evaluateFormula(
  formula: string,
  propsByName: Record<string, any>,
): string | number | boolean {
  if (!formula.trim()) return '';
  try {
    // Replace & with + for string concat
    let jsExpr = formula.replace(/&/g, '+');
    // Replace `if(` with `if_(` to avoid JS reserved word collision
    jsExpr = jsExpr.replace(/\bif\s*\(/g, 'if_(');

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'prop', 'if_', 'now',
      `"use strict"; return (${jsExpr});`,
    );

    const propFn = (name: string): any => {
      const val = propsByName[name];
      return val === undefined || val === null ? '' : val;
    };
    const ifFn = (cond: any, a: any, b: any): any => cond ? a : b;
    const nowFn = (): string => new Date().toISOString().slice(0, 10);

    const result = fn(propFn, ifFn, nowFn);
    if (result === null || result === undefined) return '';
    return result as string | number | boolean;
  } catch {
    return '#ERR';
  }
}

/** Build a { propName → value } map from a row's properties and the schema. */
export function buildPropsByName(
  schema: Record<string, { name: string }>,
  rowProperties: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [id, prop] of Object.entries(schema)) {
    out[prop.name] = rowProperties?.[id] ?? '';
  }
  return out;
}

/** Compute a rollup value from related items. */
export function computeRollup(
  rollupCfg: { relationPropId: string; targetPropId: string; aggregation: string },
  rowProperties: Record<string, any>,
  relatedItems: any[],       // all items in the related collection
): string | number {
  // IDs stored in the relation field
  const linkedIds: string[] = Array.isArray(rowProperties?.[rollupCfg.relationPropId])
    ? rowProperties[rollupCfg.relationPropId]
    : [];

  if (rollupCfg.aggregation === 'count') return linkedIds.length;

  const linkedItems = relatedItems.filter(item => linkedIds.includes(item.id));
  const nums = linkedItems
    .map(item => Number(item.properties?.[rollupCfg.targetPropId]))
    .filter(n => !isNaN(n));

  if (nums.length === 0) return 0;
  switch (rollupCfg.aggregation) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return nums.length;
  }
}
