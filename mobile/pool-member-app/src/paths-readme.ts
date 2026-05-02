/**
 * Babel module-resolver alternative is not used here; instead we rely on
 * Metro's native support for paths via tsconfig.json + babel.config.js.
 * Most apps work without an explicit module-resolver. If you encounter
 * "Cannot find module '@/...'" errors after install, run:
 *
 *   npm install --save-dev babel-plugin-module-resolver
 *
 * and add to babel.config.js:
 *
 *   plugins: [
 *     ["module-resolver", { alias: { "@": "./src" } }]
 *   ]
 */
export {};
