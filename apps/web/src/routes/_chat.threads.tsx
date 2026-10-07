import { createFileRoute } from "@tanstack/react-router";
import { ThreadGrid } from "../components/threads/ThreadGrid";

export const Route = createFileRoute("/_chat/threads")({ component: ThreadGrid });
