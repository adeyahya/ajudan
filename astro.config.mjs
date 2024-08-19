import { defineConfig } from 'astro/config';
import daisyui from "daisyui"

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind()]
});