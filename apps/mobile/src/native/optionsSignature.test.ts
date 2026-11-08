import { expect, it } from "vite-plus/test";
import { optionsSignature } from "./optionsSignature";

it("signs nested header items without invoking context getters", () => {
  const context = {
    name: "LinkingContext",
    get options() {
      throw new Error("A navigation provider is required");
    },
  };

  expect(optionsSignature([{ element: { context } }])).toContain('"options":[accessor]');
  expect(optionsSignature([{ element: { context } }])).toBe(
    optionsSignature([{ element: { context } }]),
  );
});
