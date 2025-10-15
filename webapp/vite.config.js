var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: Number((_a = process.env.VITE_PORT) !== null && _a !== void 0 ? _a : 5173),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    }
});
