# Vendored: postgres.js

Source: https://github.com/porsager/postgres (the `postgres` npm package),
tag `v3.4.9`, `src/` directory copied verbatim. License: Unlicense (see
`LICENSE` in this folder).

Why vendored instead of an `npm install`: this project's dev sandbox can't
reach the npm registry, and vendoring a single zero-dependency, pure-JS
client (no native bindings, only Node built-ins: `net`, `tls`, `crypto`,
`fs`, `os`, `stream`, `perf_hooks`) keeps the project's original
"no npm install step" philosophy basically intact -- there's still no
`node_modules` to manage, just one more set of plain `.js` files alongside
everything else in `src/`.

To pick up a newer version later (bug fixes, etc.), re-copy the `src/`
folder from a newer tag at https://github.com/porsager/postgres/tags --
nothing in this folder has been modified from upstream.

Used from `src/db.js` as the Postgres client -- see that file for how
queries are run.
