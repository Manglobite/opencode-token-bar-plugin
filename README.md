# opencode-session-token-bar

[English](README.md) | [Русский](README.ru.md)

A collapsible token-statistics bar for the OpenCode TUI. It appears directly
above the session prompt and aggregates the root session and every descendant
session recursively.

## Features

- Aggregates cache-hit input, cache-miss input, output, and hit rate across a
  complete session tree.
- Groups expanded rows by the exact `(agent, providerID, modelID)` tuple.
- Starts collapsed. Click `^` to expand or `v` to collapse; the setting is
  persisted in the local TUI key-value store.
- Tracks accumulated active time while any participating session is `busy` or
  `retry`.
- Keeps token columns fixed-width and clips the agent/model label in narrow
  terminals, so numeric columns do not shift during updates.

## Install

This is a TUI plugin: it has no server component and no runtime options. Keep
the repository directory intact because the entry point imports its sibling
`src/` modules. Use a local TypeScript/TSX path in OpenCode's TUI configuration.

For a global installation, copy it below the global OpenCode configuration
directory and add the entry to `~/.config/opencode/tui.json`:

```sh
mkdir -p ~/.config/opencode/plugins
cp -r opencode-session-token-bar ~/.config/opencode/plugins/
```

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "./plugins/opencode-session-token-bar/src/index.tsx"
  ]
}
```

For a project-local installation, keep the plugin in the project and use the
same relative entry in that project's `tui.json`, adjusted for the file's
location. The supplied [tui.example.json](tui.example.json) is a ready-to-copy
global example. If `tui.json` already has a `plugin` array, append this entry;
do not replace existing plugins.

OpenCode loads TUI configuration and plugins at startup. Quit and restart it
after installing, removing, moving, or updating the plugin or `tui.json`.

### Compatibility

The package declares peer dependencies on these exact versions: `@opencode-ai/plugin`
and `@opencode-ai/sdk` `1.3.17`, `@opentui/core` and `@opentui/solid` `0.1.96`,
and `solid-js` `1.9.11`. Install compatible dependencies in the environment
that loads the plugin. The package export is `src/index.tsx`; there is no npm
configuration object or environment-variable configuration surface.

## Metrics and session tree

The bar derives token values only from persisted assistant-message history via
`session.messages`; it does not store token totals. For every assistant message:

- `in hit` is non-negative `tokens.cache.read`.
- `in miss` is `max(0, tokens.input - tokens.cache.read)`.
- `out` is non-negative `tokens.output`.
- `hit rate` is `in hit / (in hit + in miss)`, or `0.0%` when there is no input.

The plugin follows `parentID` links to find the root, then includes its
transitive descendants. The summary contains all of their rows, while expanded
rows remain separated by their exact agent/provider/model tuple. The displayed
model label is the segment after the final `/` in `modelID`.

## Persistence and lifecycle

- Expanded state is stored locally as `session-token-bar.expanded`.
- Active time is stored per root session as
  `session-token-bar.active-time.<sessionID>` with `{ elapsed, started? }`.
- A running interval starts while any included session is `busy` or `retry` and
  closes when all are idle. Open intervals are also closed during `onDispose`.
- On restore, a stale `started` marker is deliberately discarded so time while
  OpenCode was not running is not counted.
- Token totals are rebuilt from history. Deleted or unavailable history produces
  no totals for that session. An abnormal termination can lose only the current
  unclosed active-time interval. TUI storage is local and is not synchronized
  between machines.

## Tests

```sh
bun test
bun run typecheck
```

Tests cover aggregation, exact-tuple grouping, recursive session trees, active
time persistence, and restore behavior.

## Limitations

- The plugin is visible only in the OpenCode TUI.
- Waiting for user input is not active time.
- The toggle requires mouse support in the TUI.
- The plugin makes no network requests and contacts no external services.

## License

[MIT](LICENSE)
