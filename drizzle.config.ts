import path from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.join(process.env.AJUDAN_DATA_DIR ?? "data", "ajudan.db"),
  },
});
