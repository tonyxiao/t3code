import { isValidElement } from "react";

// React tags elements, component types and contexts with `$$typeof`; their other
// fields are React internals. In development an element's `_owner` is a fiber that
// reaches the whole tree, including contexts that hold their default value outside
// render, and React Navigation's NavigationStateContext default throws when read.
export function isReactObject(value: object): boolean {
  return "$$typeof" in value;
}

const identityIds = new WeakMap<object, number>();
let nextIdentityId = 0;

function identitySignature(value: unknown): string {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return String(value);
  }
  let id = identityIds.get(value);
  if (id === undefined) {
    id = nextIdentityId++;
    identityIds.set(value, id);
  }
  return `identity:${id}`;
}

export function optionsSignature(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return JSON.stringify(value);
    case "undefined":
      return "undefined";
    case "function":
      // Compare factory source; inline references change every render and would loop setOptions.
      return `function:${Function.prototype.toString.call(value)}`;
    case "symbol":
      return `symbol:${String(value)}`;
    case "bigint":
      return `bigint:${String(value)}`;
    case "object": {
      const object = value as object;
      if (isValidElement(object)) {
        // Elements are recreated on every render, so compare what they render.
        return `element:${identitySignature(object.type)}:${String(object.key)}:${optionsSignature(object.props, seen)}`;
      }
      if (isReactObject(object)) return identitySignature(object);
      if (seen.has(object)) return "[circular]";
      seen.add(object);
      if (Array.isArray(value)) {
        return `[${value.map((entry) => optionsSignature(entry, seen)).join(",")}]`;
      }
      // Ignore mutable native refs when comparing static screen options.
      if ("current" in object) return "[ref]";
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => {
          const property = Object.getOwnPropertyDescriptor(object, key);
          const entry =
            property && "value" in property ? optionsSignature(property.value, seen) : "[accessor]";
          return `${JSON.stringify(key)}:${entry}`;
        })
        .join(",")}}`;
    }
  }
  return String(value);
}
