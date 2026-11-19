/**
 * Dependency-free JSON Schema (draft-07 subset) validator.
 *
 * Scope is deliberate: the schemas here are ours, so we only need the keywords
 * we actually use. Keeping the toolchain installable with zero network access
 * matters more than covering keywords nothing emits. Swapping in ajv later is a
 * one-file change — the exported surface is just validate(schema, data).
 *
 * Supported: type, enum, const, required, properties, additionalProperties,
 * items, minItems, minLength, pattern, minimum, maximum, $ref (local $defs),
 * anyOf, oneOf.
 */

const typeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

const matchesType = (value, expected) => {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
};

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, part) => {
      if (node == null) return null;
      return node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
}

function check(schema, data, path, root, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) {
      errors.push({ path, message: `unresolvable $ref ${schema.$ref}` });
      return;
    }
    check(resolved, data, path, root, errors);
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(data, t))) {
      errors.push({ path, message: `expected ${types.join(" | ")}, got ${typeOf(data)}` });
      return; // further checks would be noise
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    errors.push({ path, message: `value ${JSON.stringify(data)} not in enum [${schema.enum.join(", ")}]` });
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  }

  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) {
      errors.push({ path, message: `string does not match pattern ${schema.pattern}` });
    }
  }

  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path, message: `${data} < minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path, message: `${data} > maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path, message: `array shorter than minItems ${schema.minItems}` });
    }
    if (schema.items) {
      data.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, root, errors));
    }
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(data, key)) {
        errors.push({ path: `${path}.${key}`, message: "required property missing" });
      }
    }

    const props = schema.properties ?? {};
    for (const [key, value] of Object.entries(data)) {
      if (props[key]) {
        check(props[key], value, `${path}.${key}`, root, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, message: "additional property not allowed" });
      } else if (typeof schema.additionalProperties === "object") {
        check(schema.additionalProperties, value, `${path}.${key}`, root, errors);
      }
    }
  }

  if (schema.anyOf) {
    const ok = schema.anyOf.some((sub) => {
      const local = [];
      check(sub, data, path, root, local);
      return local.length === 0;
    });
    if (!ok) errors.push({ path, message: "value matched none of anyOf" });
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => {
      const local = [];
      check(sub, data, path, root, local);
      return local.length === 0;
    });
    if (matches.length !== 1) {
      errors.push({ path, message: `expected exactly one oneOf match, got ${matches.length}` });
    }
  }
}

export function validate(schema, data, { rootPath = "$" } = {}) {
  const errors = [];
  check(schema, data, rootPath, schema, errors);
  return { valid: errors.length === 0, errors };
}

export function assertValid(schema, data, label = "data") {
  const result = validate(schema, data);
  if (!result.valid) {
    const detail = result.errors.slice(0, 8).map((e) => `  ${e.path}: ${e.message}`).join("\n");
    const more = result.errors.length > 8 ? `\n  …and ${result.errors.length - 8} more` : "";
    throw new Error(`${label} failed schema validation:\n${detail}${more}`);
  }
  return true;
}
