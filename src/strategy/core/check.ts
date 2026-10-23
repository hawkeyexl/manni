/**
 * `strategy check`'s rules (proposal 0102). Pure: it reads records and
 * references and returns findings, so the command core owns every file and
 * the rules are tested on sets built inline.
 *
 * Ids compare case-folded. A reference field is checked only when the set
 * holds a record of that field's type, so a repo that keeps no audience
 * records keeps free-form `audiences:`. `missing-parent` and the use counts
 * read pages that are not records: a record's own `journeys:` serves nobody.
 */
import { closestName } from "../../shared/closest-name.js";
import { RECORD_FIELDS } from "../../shared/reference-fields.js";
import {
  PAGE_FIELDS,
  PARENTS,
  type At,
  type ChildType,
  type RecordType,
  type ReferenceField,
  type StrategyFinding,
  type StrategyRecord,
  type StrategyRule,
  type StrategySet,
  type StrategySeverity,
} from "../types.js";
import { guidanceFor, resolveSeverity, ruleId } from "./severity.js";

const fold = (value: string): string => value.toLowerCase();

/** The type each page field names. */
const FIELD_TYPES: Readonly<Record<ReferenceField, RecordType>> = RECORD_FIELDS;

/** The type of a child's parents: an audience for a persona, a persona for a journey. */
const parentTypeOf = (type: ChildType): RecordType => FIELD_TYPES[PARENTS[type]];

/** What a set's records and pages say about each other, resolved once for `check`, `list` and `get`. */
export interface StrategyIndex {
  /** Whether the set holds a record of this type. */
  has(type: RecordType): boolean;
  /** The record of `type` a value names, case-folded. The first one read wins. */
  resolve(type: RecordType, value: string): StrategyRecord | undefined;
  /** The first record of any type with this id, case-folded. */
  anyWithId(value: string): StrategyRecord | undefined;
  /** The records of the parent type the record's parent field names, each once, in the field's order. */
  parentsOf(record: StrategyRecord): StrategyRecord[];
  /** The records whose parent field names this record, in set order. */
  childrenOf(record: StrategyRecord): StrategyRecord[];
  /** The pages that name this record directly, sorted. Records do not count. */
  pagesNaming(record: StrategyRecord): string[];
}

export function indexSet(set: StrategySet): StrategyIndex {
  const byType = new Map<RecordType, Map<string, StrategyRecord>>();
  const byId = new Map<string, StrategyRecord>();
  for (const record of set.records) {
    const ids = byType.get(record.type) ?? new Map<string, StrategyRecord>();
    if (!ids.has(fold(record.id))) ids.set(fold(record.id), record);
    byType.set(record.type, ids);
    if (!byId.has(fold(record.id))) byId.set(fold(record.id), record);
  }
  const resolveIn = (type: RecordType, value: string): StrategyRecord | undefined => byType.get(type)?.get(fold(value));
  const parentsOf = (record: StrategyRecord): StrategyRecord[] => {
    if (record.type === "audience") return [];
    const type = parentTypeOf(record.type);
    const found = record.parents.map((p) => resolveIn(type, p.value)).filter((r) => r !== undefined);
    return [...new Set(found)];
  };

  const children = new Map<StrategyRecord, StrategyRecord[]>();
  for (const record of set.records) {
    for (const parent of parentsOf(record)) children.set(parent, [...(children.get(parent) ?? []), record]);
  }
  const pages = new Map<StrategyRecord, Set<string>>();
  for (const reference of set.references) {
    if (reference.record) continue;
    const target = resolveIn(FIELD_TYPES[reference.field], reference.value);
    if (target === undefined) continue;
    const named = pages.get(target) ?? new Set<string>();
    named.add(reference.page);
    pages.set(target, named);
  }

  return {
    has: (type) => (byType.get(type)?.size ?? 0) > 0,
    resolve: resolveIn,
    anyWithId: (value) => byId.get(fold(value)),
    parentsOf,
    childrenOf: (record) => children.get(record) ?? [],
    pagesNaming: (record) => [...(pages.get(record) ?? [])].sort(),
  };
}

/** A finding before its level is known: `message` is its identity, `fix` the advice after it. */
interface Draft {
  rule: StrategyRule;
  message: string;
  fix?: string;
  file: string;
  line?: number;
  id?: string;
  field?: ReferenceField;
}

/** `a journey`, `an audience`. */
function article(type: RecordType): string {
  return `${type === "audience" ? "an" : "a"} ${type}`;
}

/** Where a finding about a whole record sits: its `id:` line, else its first line. */
function onRecord(record: StrategyRecord): At {
  return record.idAt ?? { file: record.file, line: record.line };
}

function located(at: At): At {
  return { file: at.file, ...(at.line === undefined ? {} : { line: at.line }) };
}

/** The ancestor of `record` of type `type`, walking up each record's first parent. */
function ancestorOf(index: StrategyIndex, record: StrategyRecord, type: RecordType): StrategyRecord | undefined {
  let current = index.parentsOf(record)[0];
  while (current !== undefined && current.type !== type) current = index.parentsOf(current)[0];
  return current;
}

export interface CheckStrategySetOptions {
  severity?: Partial<Record<StrategyRule, StrategySeverity>>;
}

export function checkStrategySet(set: StrategySet, opts: CheckStrategySetOptions = {}): StrategyFinding[] {
  const levels = resolveSeverity(opts.severity);
  const index = indexSet(set);
  const drafts: Draft[] = [];

  /** The finding for a value that names no record of `type`, or the wrong type of record. */
  const unresolved = (field: ReferenceField, value: string, onRecordField: boolean): Pick<Draft, "message" | "fix"> => {
    const type = FIELD_TYPES[field];
    const other = index.anyWithId(value);
    if (other !== undefined) {
      const ancestor = ancestorOf(index, other, type);
      const fix =
        ancestor !== undefined
          ? `Did you mean its ${type}, "${ancestor.id}"?`
          : onRecordField
            ? "Correct the value."
            : `Move it to ${PAGE_FIELDS[other.type]}:.`;
      return { message: `${field}: "${value}" is ${article(other.type)}, not ${article(type)}.`, fix };
    }
    const ids = set.records.filter((r) => r.type === type).map((r) => r.id);
    const nearest = closestName(fold(value), ids.map(fold));
    const suggestion = nearest === undefined ? undefined : ids.find((id) => fold(id) === nearest);
    const add = `Correct the value, or add a record with type: ${type} and id: ${value}.`;
    const fix =
      suggestion === undefined ? add : onRecordField ? `Did you mean "${suggestion}"?` : `Did you mean "${suggestion}"? ${add}`;
    return { message: `${field}: "${value}" names no ${type}.`, fix };
  };

  // undefined-reference, on every page's fields, records included.
  for (const reference of set.references) {
    const type = FIELD_TYPES[reference.field];
    if (!index.has(type) || index.resolve(type, reference.value) !== undefined) continue;
    drafts.push({
      rule: "undefined-reference",
      ...unresolved(reference.field, reference.value, false),
      ...located(reference),
      field: reference.field,
    });
  }
  // ...and on each value of a record's parent field.
  for (const record of set.records) {
    if (record.type === "audience") continue;
    const field = PARENTS[record.type];
    const type = parentTypeOf(record.type);
    if (!index.has(type)) continue;
    for (const parent of record.parents) {
      if (index.resolve(type, parent.value) !== undefined) continue;
      drafts.push({
        rule: "undefined-reference",
        ...unresolved(field, parent.value, true),
        ...located(parent),
        id: record.id,
        field,
      });
    }
  }

  // duplicate-id: on every record sharing the id, each naming the others.
  const sharing = new Map<string, StrategyRecord[]>();
  for (const record of set.records) sharing.set(fold(record.id), [...(sharing.get(fold(record.id)) ?? []), record]);
  for (const group of sharing.values()) {
    if (group.length < 2) continue;
    for (const record of group) {
      const others = group
        .filter((other) => other !== record)
        .map((other) => {
          const at = onRecord(other);
          return at.line === undefined ? at.file : `${at.file}:${String(at.line)}`;
        });
      drafts.push({
        rule: "duplicate-id",
        message: `id: "${record.id}" is also the id of ${others.join(", ")}.`,
        fix: "Give each record its own id.",
        ...located(onRecord(record)),
        id: record.id,
      });
    }
  }

  // missing-parent: per page, one finding per set of parents the page names none of.
  const byPage = new Map<string, typeof set.references>();
  for (const reference of set.references) {
    if (reference.record) continue;
    byPage.set(reference.page, [...(byPage.get(reference.page) ?? []), reference]);
  }
  for (const references of byPage.values()) {
    const named = (field: ReferenceField): Set<string> =>
      new Set(references.filter((r) => r.field === field).map((r) => fold(r.value)));
    const reported = new Set<string>();
    for (const childType of ["journey", "persona"] as const satisfies readonly ChildType[]) {
      const parentType = parentTypeOf(childType);
      const parentField = PAGE_FIELDS[parentType];
      const has = named(parentField);
      for (const reference of references) {
        if (reference.field !== PAGE_FIELDS[childType]) continue;
        const child = index.resolve(childType, reference.value);
        if (child === undefined) continue;
        const parents = index.parentsOf(child);
        const ids = parents.map((p) => `"${p.id}"`).join(", ");
        const key = `${parentType} ${ids}`;
        if (parents.length === 0 || parents.some((p) => has.has(fold(p.id))) || reported.has(key)) continue;
        reported.add(key);
        const one = parents.length === 1;
        drafts.push({
          rule: "missing-parent",
          message: one
            ? `${parentField}: does not name ${ids}, the ${parentType} of ${childType} "${child.id}".`
            : `${parentField}: names none of ${ids}, the ${parentField} of ${childType} "${child.id}".`,
          fix: `Add ${one ? "it" : "one"}, or drop "${child.id}" from ${PAGE_FIELDS[childType]}:.`,
          ...located(reference),
          field: parentField,
        });
      }
    }
  }

  // orphan-record, unserved-journey and unused-record: about whole records.
  for (const record of set.records) {
    const at = located(onRecord(record));
    if (record.type !== "audience" && record.parents.length === 0 && index.has(parentTypeOf(record.type))) {
      const field = PARENTS[record.type];
      drafts.push({
        rule: "orphan-record",
        message: `${field}: missing, so this ${record.type} belongs to no ${parentTypeOf(record.type)}.`,
        fix: `Name one with ${field}:.`,
        ...at,
        id: record.id,
        field,
      });
    }
    // Only the first record with an id is the one references resolve to.
    if (index.resolve(record.type, record.id) !== record) continue;
    const pages = index.pagesNaming(record);
    // A draft journey is not live yet, and an archived one no longer is, so neither owes a page.
    const live = record.lifecycle !== "draft" && record.lifecycle !== "archived";
    if (record.type === "journey" && live && pages.length === 0) {
      drafts.push({
        rule: "unserved-journey",
        message: "no page names this journey in journeys:.",
        fix: "Name it on the pages that serve it.",
        ...at,
        id: record.id,
      });
    }
    if (record.type !== "journey" && pages.length === 0 && index.childrenOf(record).length === 0) {
      drafts.push({
        rule: "unused-record",
        message: `no page and no record names this ${record.type}.`,
        ...at,
        id: record.id,
      });
    }
  }

  const findings: StrategyFinding[] = [];
  for (const draft of drafts) {
    const level = levels[draft.rule];
    if (level === "off") continue;
    findings.push({
      rule: draft.rule,
      ruleId: ruleId(draft.rule),
      severity: level,
      message: draft.fix === undefined ? draft.message : `${draft.message} ${draft.fix}`,
      ...(draft.fix === undefined ? {} : { key: draft.message }),
      guidance: guidanceFor(draft.rule),
      file: draft.file,
      ...(draft.line === undefined ? {} : { line: draft.line }),
      ...(draft.id === undefined ? {} : { id: draft.id }),
      ...(draft.field === undefined ? {} : { field: draft.field }),
    });
  }
  return findings.sort(compareFindings);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareFindings(a: StrategyFinding, b: StrategyFinding): number {
  return (
    compareText(a.file, b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareText(a.ruleId, b.ruleId) ||
    compareText(a.message, b.message)
  );
}
