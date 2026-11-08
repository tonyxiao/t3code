/** Shared by all provider runtime contexts; rendering uses the stored message text. */
export const RICH_CHAT_INSTRUCTIONS = `<chat_rendering>
T3 Code renders fenced mermaid diagrams inline in chat history. Use a mermaid fence for diagrams.
For interactive cards, use a json-render fence containing one JSON object: {"root":"card","elements":{"card":{"type":"Card","props":{"title":"Title"},"children":["text"]},"text":{"type":"Text","props":{"content":"Hello"}}},"state":{}}.
Supported components and props: Card {title?,subtitle?}; Section {}; Text {content,style?:"plain"|"bold"|"muted"}; Fields {}; Field {label,value}; Table {headers:string[],rows:(string|number)[][],caption?}; Chart {title,chart:{type:"bar"|"line"|"area",categories:string[],series:{name,values:number[]}[]}}; Divider {}; Actions {}; Button {label}; Input {label,statePath:"/form/name",placeholder?}; Mermaid {code}.
Containers use children containing element IDs. Input binds to local state. A button can change local state with on:{"press":{"action":"setState","params":{"statePath":"/form/name","value":"new value"}}}. Only local setState actions are supported; buttons cannot send messages or run tools. Form state is temporary and resets when reopened. Use at most 200 elements. Include complete, valid JSON and close the fence. Use these cards when useful, not for every reply.
</chat_rendering>`;
