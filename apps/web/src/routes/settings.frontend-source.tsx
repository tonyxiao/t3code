import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/frontend-source")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/javascript-source", replace: true });
  },
});
