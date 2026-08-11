// eslint-config-next 16 ships native flat configs, so FlatCompat is not needed
// (and breaks — it tries to JSON.stringify a config with circular plugin refs).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Generated from the OpenAPI schema by `make types` — never hand-edited.
    // Generated: api-types.ts from the OpenAPI schema, design/ from the
    // .dc.html prototypes. Linting them would pressure edits to generated
    // output instead of to the source.
    ignores: [
      ".next/**",
      // The isolated E2E stack's build output. Same generated bundles as
      // `.next`, in a directory of their own so two dev servers can coexist —
      // and 7,000 lint problems if they are not ignored alongside it.
      ".next-e2e/**",
      "node_modules/**",
      "src/lib/api-types.ts",
      "src/components/design/**",
    ],
  },
];

export default config;
