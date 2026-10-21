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
      // Inline header factories need a stable signature across renders.
      return `function:${Function.prototype.toString.call(value)}`;
    case "symbol":
      return `symbol:${String(value)}`;
    case "bigint":
      return `bigint:${String(value)}`;
    case "object": {
      const object = value as object;
      if (seen.has(object)) return "[circular]";
      seen.add(object);
      if (Array.isArray(value)) {
        return `[${value.map((entry) => optionsSignature(entry, seen)).join(",")}]`;
      }
      if ("current" in object) return "[ref]";
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => {
          const property = Object.getOwnPropertyDescriptor(object, key);
          // React context objects can have getters that require a provider.
          const entry =
            property && "value" in property ? optionsSignature(property.value, seen) : "[accessor]";
          return `${JSON.stringify(key)}:${entry}`;
        })
        .join(",")}}`;
    }
  }
  return String(value);
}
