// Positional rows and categories are immutable within a spec and may repeat identical values.
/* oxlint-disable react/no-array-index-key */
import { defineRegistry, JSONUIProvider, Renderer, useStateBinding } from "@json-render/react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { catalog, parseChatSpec } from "./format.ts";

let mermaidModule: Promise<typeof import("mermaid")> | undefined;
let diagramQueue = Promise.resolve();
let nextDiagramId = 0;
const diagrams = new Map<string, string>();

async function renderDiagram(code: string, theme: "light" | "dark") {
  const key = `${theme}:${code}`;
  const cached = diagrams.get(key);
  if (cached) return cached;
  // Mermaid has process-wide configuration; serialize renders across mounted messages.
  let result = "";
  const next = diagramQueue.then(async () => {
    const { default: mermaid } = await (mermaidModule ??= import("mermaid"));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      theme: theme === "dark" ? "dark" : "default",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      flowchart: { htmlLabels: false },
    });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
    document.body.append(host);
    try {
      const rendered = await mermaid.render(`diagram-${++nextDiagramId}`, code, host);
      result = rendered.svg.replace(
        "</svg>",
        "<style>*{animation:none!important;transition:none!important}</style></svg>",
      );
      if (diagrams.size >= 16) diagrams.delete(diagrams.keys().next().value ?? "");
      if (result.length <= 250_000) diagrams.set(key, result);
    } finally {
      host.remove();
    }
  });
  diagramQueue = next.catch(() => {});
  await next;
  return result;
}

export function MermaidDiagram({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const [result, setResult] = useState<{ key: string; svg?: string; error?: string }>();
  const key = `${theme}:${code}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- renders with Mermaid’s async DOM API and ignores completion after unmount
  useEffect(() => {
    let cancelled = false;
    if (code.length > 50_000) return;
    void renderDiagram(code, theme).then(
      (svg) => {
        if (!cancelled) setResult({ key, svg });
      },
      () => {
        if (!cancelled) setResult({ key, error: "This Mermaid diagram could not be rendered." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, theme, key]);
  if (code.length > 50_000) return <p role="alert">This diagram is too large to render.</p>;
  if (result?.key !== key) return <p role="status">Rendering diagram…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return (
    <div style={{ overflow: "auto" }}>
      <img
        alt="Mermaid diagram"
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg ?? "")}`}
      />
    </div>
  );
}

function BoundInput({
  label,
  statePath,
  placeholder,
}: {
  label: string;
  statePath: string;
  placeholder?: string | undefined;
}) {
  const id = useId();
  const [value, setValue] = useStateBinding(statePath);
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 4 }}>
      {label}
      <input
        style={{
          minHeight: 44,
          padding: 8,
          border: "1px solid var(--rich-border)",
          borderRadius: 4,
          background: "transparent",
          color: "inherit",
          font: "inherit",
          // iOS zooms focused inputs whose text is smaller than 16 CSS pixels.
          fontSize: "max(16px, 1em)",
        }}
        id={id}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}

const palette = ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed"];
const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <section
        style={{
          border: "1px solid var(--rich-border)",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        {props.title && <strong>{props.title}</strong>}
        {props.subtitle && <p style={{ opacity: 0.75 }}>{props.subtitle}</p>}
        {children}
      </section>
    ),
    Section: ({ children }) => <div style={{ display: "grid", gap: 12 }}>{children}</div>,
    Text: ({ props }) => (
      <p
        style={{
          fontWeight: props.style === "bold" ? 600 : undefined,
          opacity: props.style === "muted" ? 0.7 : undefined,
          whiteSpace: "pre-wrap",
        }}
      >
        {props.content}
      </p>
    ),
    Fields: ({ children }) => (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
          gap: 12,
        }}
      >
        {children}
      </div>
    ),
    Field: ({ props }) => (
      <div>
        <div style={{ fontSize: "0.85em", opacity: 0.7 }}>{props.label}</div>
        <strong>{props.value}</strong>
      </div>
    ),
    Table: ({ props }) => (
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          {props.caption && <caption>{props.caption}</caption>}
          <thead>
            <tr>
              {props.headers.map((header, index) => (
                <th key={index} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    Chart: ({ props }) => {
      const { chart } = props;
      const values = chart.series.flatMap((series) => series.values);
      const min = Math.min(0, ...values);
      const max = Math.max(0, ...values);
      const scale = (value: number) => 170 - ((value - min) / (max - min || 1)) * 150;
      const baseline = scale(0);
      const width = 600 / chart.categories.length;
      return (
        <figure style={{ margin: 0 }}>
          <figcaption>{props.title}</figcaption>
          <svg viewBox="0 0 600 200" role="img" aria-label={props.title} style={{ width: "100%" }}>
            {chart.series.map((series, index) => {
              const color = palette[index % palette.length];
              const points = series.values
                .map((value, position) => `${width * (position + 0.5)},${scale(value)}`)
                .join(" ");
              return (
                <g key={index}>
                  {chart.type === "bar" ? (
                    series.values.map((value, position) => (
                      <rect
                        key={position}
                        x={position * width + (index * width) / chart.series.length + 2}
                        y={Math.min(scale(value), baseline)}
                        width={Math.max(1, width / chart.series.length - 4)}
                        height={Math.abs(scale(value) - baseline)}
                        fill={color}
                      >
                        <title>
                          {series.name}: {chart.categories[position]} {value}
                        </title>
                      </rect>
                    ))
                  ) : (
                    <>
                      {chart.type === "area" && (
                        <polygon
                          points={`${width / 2},${baseline} ${points} ${600 - width / 2},${baseline}`}
                          fill={color}
                          opacity={0.2}
                        />
                      )}
                      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
                    </>
                  )}
                </g>
              );
            })}
            {chart.categories.map((category, index) =>
              index % Math.ceil(chart.categories.length / 8) === 0 ? (
                <text
                  key={index}
                  x={width * (index + 0.5)}
                  y={192}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize={11}
                >
                  {category.slice(0, 12)}
                </text>
              ) : null,
            )}
          </svg>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {chart.series.map((series, index) => (
              <span key={index}>
                <span aria-hidden style={{ color: palette[index % palette.length] }}>
                  ●{" "}
                </span>
                {series.name}
              </span>
            ))}
          </div>
          <details>
            <summary>Chart data</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  {chart.series.map((series, index) => (
                    <th key={index} scope="col">
                      {series.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.categories.map((category, index) => (
                  <tr key={index}>
                    <th scope="row">{category}</th>
                    {chart.series.map((series, seriesIndex) => (
                      <td key={seriesIndex}>{series.values[index]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      );
    },
    Divider: () => <hr />,
    Actions: ({ children }) => (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>
    ),
    Button: ({ props, emit, on }) => (
      <button
        style={{
          minHeight: 44,
          padding: "8px 12px",
          border: "1px solid var(--rich-border)",
          borderRadius: 4,
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
        }}
        type="button"
        disabled={!on("press").bound}
        onClick={() => emit("press")}
      >
        {props.label}
      </button>
    ),
    Input: ({ props }) => <BoundInput {...props} />,
    Mermaid: ({ props }) => <ThemedMermaid code={props.code} />,
  },
});

const ThemeContext = createContext<"light" | "dark">("light");
function ThemedMermaid({ code }: { code: string }) {
  return <MermaidDiagram code={code} theme={useContext(ThemeContext)} />;
}

export function RichContent({
  source,
  language,
  theme,
}: {
  source: string;
  language: "mermaid" | "json-render";
  theme: "light" | "dark";
}) {
  const result = useMemo(() => {
    if (language === "mermaid") return null;
    try {
      return { spec: parseChatSpec(source) };
    } catch {
      return { error: "This json-render card is invalid or uses unsupported components." };
    }
  }, [source, language]);
  return (
    <ThemeContext value={theme}>
      <div
        data-markdown-copy={["", "", "```" + language, source, "```", "", ""].join("\n")}
        className="t3-rich-content"
        style={
          {
            colorScheme: theme,
            color: theme === "dark" ? "#e5e7eb" : "#1f2937",
            "--rich-border": theme === "dark" ? "#4b5563" : "#d1d5db",
          } as CSSProperties
        }
      >
        {language === "mermaid" ? (
          <MermaidDiagram code={source} theme={theme} />
        ) : result && "spec" in result ? (
          <JSONUIProvider key={source} registry={registry} initialState={result.spec.state ?? {}}>
            <Renderer spec={result.spec} registry={registry} />
          </JSONUIProvider>
        ) : (
          <p role="alert">{result?.error}</p>
        )}
        <details style={{ marginTop: 8 }}>
          <summary>View source</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{source}</pre>
        </details>
      </div>
    </ThemeContext>
  );
}
