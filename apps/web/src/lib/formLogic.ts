/**
 * Conditional-logic evaluator for the form engine.
 *
 * The twin of `app/features/forms/schema.py`. Both are replayed against
 * `fixtures/form-logic-cases.json` so they cannot drift: this one gives the
 * speaker immediate feedback, the server one decides.
 */

export type Choice = { value: string; label: string };

export type FormField = {
  key: string;
  type: string;
  label: string;
  help_text: string | null;
  required: boolean;
  choices: Choice[];
  hidden_from_new: boolean;
  identity_bearing: boolean;
};

export type LogicRule = {
  field: string;
  operator: "is" | "is_not" | "is_any_of" | "is_empty" | "is_not_empty" | "gt" | "lt";
  value: unknown;
  action: "show" | "hide" | "require";
  target: string;
};

export type FormSchema = {
  sections: { key: string; title: string; description: string | null; fields: FormField[] }[];
  logic: LogicRule[];
  settings: { confirmation_message: string };
};

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function matches(rule: LogicRule, answer: unknown): boolean {
  switch (rule.operator) {
    case "is":
      return answer === rule.value;
    case "is_not":
      return answer !== rule.value;
    case "is_any_of": {
      const options = Array.isArray(rule.value) ? rule.value : [rule.value];
      return Array.isArray(answer)
        ? answer.some((a) => options.includes(a))
        : options.includes(answer);
    }
    case "is_empty":
      return isEmpty(answer);
    case "is_not_empty":
      return !isEmpty(answer);
    case "gt":
    case "lt": {
      const left = Number(answer);
      const right = Number(rule.value);
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      return rule.operator === "gt" ? left > right : left < right;
    }
    default:
      return false;
  }
}

export function resolveVisibility(
  schema: FormSchema,
  answers: Record<string, unknown>,
): { visible: Set<string>; required: Set<string> } {
  // A field any rule targets with `show` starts hidden: "show prerequisites when
  // format is Workshop" has to mean absent otherwise, not merely re-shown.
  const conditional = new Set(schema.logic.filter((r) => r.action === "show").map((r) => r.target));
  const live = schema.sections.flatMap((s) => s.fields).filter((f) => !f.hidden_from_new);

  const visible = new Set(live.filter((f) => !conditional.has(f.key)).map((f) => f.key));
  const required = new Set(live.filter((f) => f.required).map((f) => f.key));

  for (const rule of schema.logic) {
    if (!matches(rule, answers[rule.field])) continue;
    if (rule.action === "show") visible.add(rule.target);
    else if (rule.action === "hide") visible.delete(rule.target);
    else required.add(rule.target);
  }

  // A hidden field is never required: the classic form nobody can submit.
  for (const key of [...required]) {
    if (!visible.has(key)) required.delete(key);
  }

  return { visible, required };
}
