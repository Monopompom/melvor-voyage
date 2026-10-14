// Pure location rules: which skills are locked by terrain and where they work. No game globals.
// Phase 1 gates one skill; phase 2 brings the full tier table and the Relaxed/Strict setting.

/** skill id -> where it may start. A hex passes if its class is listed or it carries a listed feature. */
export const SKILL_RULES = {
  'melvorD:Woodcutting': { classes: ['forest'], features: [], noun: 'forest' },
};

export function gatedSkillIds() {
  return Object.keys(SKILL_RULES);
}

export function isGated(skillId) {
  return Object.prototype.hasOwnProperty.call(SKILL_RULES, skillId);
}

/**
 * True when the skill may start on the hex described by `record` (a table row, or undefined for a hex
 * the table does not know, which always passes: fail open).
 */
export function allowedAt(skillId, record) {
  const rule = SKILL_RULES[skillId];
  if (rule === undefined || record === undefined) return true;
  if (rule.classes.includes(record.t)) return true;
  const features = Array.isArray(record.f) ? record.f : [];
  return rule.features.some((f) => features.includes(f));
}

export function ruleNoun(skillId) {
  return SKILL_RULES[skillId]?.noun ?? 'the right terrain';
}
