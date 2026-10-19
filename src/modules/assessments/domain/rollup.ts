import { findLevel, normalizedValue, type Scale } from "./scale";

// Rule 2 (ARCHITECTURE §4): element → standard → chapter → facility, with the methods an
// edition's `rollup_config` chooses. Scores are fractions of full compliance (0..1).

export const rollupMethods = ["weighted_average", "all_must_meet", "threshold"] as const;
export type RollupMethod = (typeof rollupMethods)[number];

export type RollupSettings = {
  standard: { method: RollupMethod; metThreshold: number; pmThreshold: number };
  chapter: { method: RollupMethod };
  facility: { method: RollupMethod };
};

export type RollupElement = {
  id: string;
  standardId: string;
  weight: number;
  isEsr: boolean;
  // Whether the element applies to the facility (M5). Elements that do not are left out.
  applicable: boolean;
  // The element's current level, or null when it has never been scored or its score expired.
  levelCode: string | null;
};
export type RollupStandard = { id: string; chapterId: string; weight: number };
export type RollupChapter = { id: string };

export type NodeScore = {
  // Null when nothing below counts (every element N/A or weighted 0).
  score: number | null;
  // Elements that count in the denominator, and how many of them have a current score.
  counted: number;
  scored: number;
  // ESR elements below this node that are scored below full compliance, or not verified.
  esrNotMet: number;
  esrUnverified: number;
};

type Child = { score: number | null; weight: number };

const isFull = (score: number) => score >= 1 - 1e-9;

/**
 * Combines children's scores. Children with no score, or weight 0, do not take part.
 * - weighted_average: Σ weight·score / Σ weight.
 * - all_must_meet: 1 only when every child is fully met, otherwise 0.
 * - threshold: the weighted share of fully met children, mapped to 1 at or above
 *   `metThreshold`, 0.5 at or above `pmThreshold`, else 0 (the standard's thresholds are
 *   used at every level).
 */
export function combine(
  children: readonly Child[],
  method: RollupMethod,
  thresholds: { metThreshold: number; pmThreshold: number },
): number | null {
  const parts = children.filter(
    (c): c is { score: number; weight: number } => c.score !== null && c.weight > 0,
  );
  if (parts.length === 0) return null;
  const total = parts.reduce((sum, c) => sum + c.weight, 0);
  switch (method) {
    case "weighted_average":
      return parts.reduce((sum, c) => sum + c.weight * c.score, 0) / total;
    case "all_must_meet":
      return parts.every((c) => isFull(c.score)) ? 1 : 0;
    case "threshold": {
      const share = parts.filter((c) => isFull(c.score)).reduce((s, c) => s + c.weight, 0) / total;
      if (share >= thresholds.metThreshold - 1e-9) return 1;
      if (share >= thresholds.pmThreshold - 1e-9) return 0.5;
      return 0;
    }
  }
}

/**
 * The score of one element as roll-up sees it. Null when it does not take part (does not
 * apply, or scored N/A this time). An element that applies but has no current score counts
 * as 0: compliance nobody has verified recently cannot be claimed, and a surveyor scores
 * every applicable element.
 */
export function elementScore(element: RollupElement, scale: Scale): number | null {
  if (!element.applicable) return null;
  if (element.levelCode === null) return 0;
  const level = findLevel(scale, element.levelCode);
  if (!level) throw new Error(`Unknown score level ${element.levelCode}`);
  return normalizedValue(level, scale);
}

export type Rollup = {
  elements: Map<string, number | null>;
  standards: Map<string, NodeScore>;
  chapters: Map<string, NodeScore>;
  facility: NodeScore;
};

const emptyNode = (): Omit<NodeScore, "score"> => ({
  counted: 0,
  scored: 0,
  esrNotMet: 0,
  esrUnverified: 0,
});

function addCounts(into: Omit<NodeScore, "score">, from: Omit<NodeScore, "score">) {
  into.counted += from.counted;
  into.scored += from.scored;
  into.esrNotMet += from.esrNotMet;
  into.esrUnverified += from.esrUnverified;
}

/**
 * Scores a whole edition for one facility (or one slice of it: pass only the elements of a
 * department). A chapter weighs, at facility level, the sum of its standards' weights, so
 * a large chapter is not outvoted by a small one.
 */
export function computeRollup(
  content: {
    chapters: readonly RollupChapter[];
    standards: readonly RollupStandard[];
    elements: readonly RollupElement[];
  },
  scale: Scale,
  settings: RollupSettings,
): Rollup {
  const thresholds = settings.standard;
  const elements = new Map<string, number | null>();
  const byStandard = new Map<string, { children: Child[]; counts: Omit<NodeScore, "score"> }>();

  for (const element of content.elements) {
    const score = elementScore(element, scale);
    elements.set(element.id, score);
    const entry = byStandard.get(element.standardId) ?? { children: [], counts: emptyNode() };
    entry.children.push({ score, weight: element.weight });
    if (score !== null) {
      entry.counts.counted += 1;
      if (element.levelCode !== null) entry.counts.scored += 1;
      if (element.isEsr) {
        if (element.levelCode === null) entry.counts.esrUnverified += 1;
        else if (!isFull(score)) entry.counts.esrNotMet += 1;
      }
    }
    byStandard.set(element.standardId, entry);
  }

  const standards = new Map<string, NodeScore>();
  const byChapter = new Map<string, { children: Child[]; counts: Omit<NodeScore, "score"> }>();
  for (const standard of content.standards) {
    const entry = byStandard.get(standard.id) ?? { children: [], counts: emptyNode() };
    const node = {
      score: combine(entry.children, settings.standard.method, thresholds),
      ...entry.counts,
    };
    standards.set(standard.id, node);
    const chapter = byChapter.get(standard.chapterId) ?? { children: [], counts: emptyNode() };
    chapter.children.push({ score: node.score, weight: standard.weight });
    addCounts(chapter.counts, entry.counts);
    byChapter.set(standard.chapterId, chapter);
  }

  const chapters = new Map<string, NodeScore>();
  const facilityChildren: Child[] = [];
  const facilityCounts = emptyNode();
  for (const chapter of content.chapters) {
    const entry = byChapter.get(chapter.id) ?? { children: [], counts: emptyNode() };
    const score = combine(entry.children, settings.chapter.method, thresholds);
    chapters.set(chapter.id, { score, ...entry.counts });
    const weight = entry.children
      .filter((c) => c.score !== null)
      .reduce((sum, c) => sum + c.weight, 0);
    facilityChildren.push({ score, weight });
    addCounts(facilityCounts, entry.counts);
  }

  return {
    elements,
    standards,
    chapters,
    facility: {
      score: combine(facilityChildren, settings.facility.method, thresholds),
      ...facilityCounts,
    },
  };
}

/** The edition's stored `rollup_config` (snake_case JSON, validated at import) as settings. */
export function rollupSettingsFrom(config: {
  standard: { method: RollupMethod; met_threshold: number; pm_threshold: number };
  chapter: { method: RollupMethod };
  facility: { method: RollupMethod };
}): RollupSettings {
  return {
    standard: {
      method: config.standard.method,
      metThreshold: config.standard.met_threshold,
      pmThreshold: config.standard.pm_threshold,
    },
    chapter: { method: config.chapter.method },
    facility: { method: config.facility.method },
  };
}
