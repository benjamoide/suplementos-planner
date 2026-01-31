import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const REPO_NAME = "suplementos-planner"; // <-- TU repo exacto

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? `/${REPO_NAME}/` : "/",
}));
