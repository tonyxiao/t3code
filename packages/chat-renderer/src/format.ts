import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const text = z.string().max(50_000);
const display = z.union([text, z.number().finite()]);
const empty = z.object({}).strict();
const statePath = z
  .string()
  .regex(/^\/[\w/-]+$/)
  .max(200)
  .refine(
    (path) =>
      !path
        .split("/")
        .some((segment) => ["__proto__", "prototype", "constructor"].includes(segment)),
    "Invalid state path",
  );
const chartSeries = z.object({ name: text, values: z.array(z.number().finite()).max(200) });

/** One catalog for chat history on web, desktop and mobile. No executable component code. */
export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({ title: text.optional(), subtitle: text.optional() }),
      slots: ["default"],
      description: "Card with an optional title and subtitle.",
    },
    Section: { props: empty, slots: ["default"], description: "Vertical group of components." },
    Text: {
      props: z.object({ content: text, style: z.enum(["plain", "bold", "muted"]).optional() }),
      description: "Plain text paragraph.",
    },
    Fields: { props: empty, slots: ["default"], description: "Grid of label/value fields." },
    Field: {
      props: z.object({ label: text, value: display }),
      description: "Label and display value.",
    },
    Table: {
      props: z.object({
        headers: z.array(text).min(1).max(30),
        rows: z.array(z.array(display).max(30)).max(200),
        caption: text.optional(),
      }),
      description: "Table with headers and rows.",
    },
    Chart: {
      props: z.object({
        title: text,
        chart: z.object({
          type: z.enum(["bar", "line", "area"]),
          categories: z.array(text).min(1).max(200),
          series: z.array(chartSeries).min(1).max(10),
        }),
      }),
      description: "Bar, line or area chart with categories and named series.",
    },
    Divider: { props: empty, description: "Horizontal divider." },
    Actions: { props: empty, slots: ["default"], description: "Row of buttons." },
    Button: {
      props: z.object({ label: text }),
      description: "Emits press. Bind to setState for local interaction.",
    },
    Input: {
      props: z.object({ label: text, statePath: statePath, placeholder: text.optional() }),
      description: "Text input bound to a local statePath.",
    },
    Mermaid: { props: z.object({ code: text }), description: "Mermaid diagram source." },
  },
  actions: {},
});

const elementSchema = z
  .object({
    type: z.string(),
    props: z.record(z.string(), z.unknown()),
    children: z.array(z.string()).max(200).optional(),
    on: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const specSchema = z
  .object({
    root: z.string(),
    elements: z.record(z.string(), elementSchema),
    state: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const actionSchema = z
  .object({
    action: z.literal("setState"),
    params: z.object({ statePath, value: z.unknown() }).strict(),
  })
  .strict();

/** Validate before mounting; bound the graph, reject cycles and unknown props/actions. */
export function parseChatSpec(source: string): Spec {
  if (source.length > 250_000) throw new Error("This card is too large to render.");
  const spec = specSchema.parse(JSON.parse(source));
  const entries = Object.entries(spec.elements);
  if (entries.length > 200) throw new Error("A card can contain at most 200 elements.");
  for (const [id, element] of entries) {
    const definition = Object.entries(catalog.data.components).find(
      ([name]) => name === element.type,
    )?.[1];
    if (!definition) throw new Error(`Unsupported component: ${element.type}`);
    element.props = definition.props.parse(element.props);
    if (element.on) {
      for (const action of Object.values(element.on)) {
        for (const binding of Array.isArray(action) ? action : [action])
          actionSchema.parse(binding);
      }
    }
    if (element.type === "Table") {
      const { headers, rows } = catalog.data.components.Table.props.parse(element.props);
      if (rows.some((row) => row.length !== headers.length))
        throw new Error(`Table ${id} has mismatched columns.`);
    }
    if (element.type === "Chart") {
      const { chart } = catalog.data.components.Chart.props.parse(element.props);
      if (chart.series.some((series) => series.values.length !== chart.categories.length))
        throw new Error(`Chart ${id} has mismatched series.`);
    }
  }
  let count = 0;
  function visit(id: string, ancestors: Set<string>) {
    if (++count > 500 || ancestors.size > 30) throw new Error("This card is too deeply nested.");
    if (ancestors.has(id)) throw new Error("This card contains a cycle.");
    const element = Object.hasOwn(spec.elements, id) ? spec.elements[id] : undefined;
    if (!element) throw new Error(`Missing component: ${id}`);
    const path = new Set(ancestors).add(id);
    for (const child of element.children ?? []) visit(child, path);
  }
  visit(spec.root, new Set());
  return spec as Spec;
}
