# dassian-adt

MCP server for SAP ABAP development via the ADT API. Connect AI assistants to your SAP system — read, write, test, and deploy ABAP code without SAP GUI.

The AI can create objects, write source, activate, manage transports, run code, query tables, and check quality. Full development lifecycle, not just read-only or code generation.

## Origins

Based on [mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) by **[Mario Andreschak](https://github.com/mario-andreschak)** and the [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) library by **[Marcello Urbani](https://github.com/marcellourbani)**.

Dassian's fork adds input validation, error intelligence, MCP elicitation, session recovery, and a test suite. See [CHANGES.md](CHANGES.md) for the full list.

## What It Does

85 tools covering the full ABAP development lifecycle:

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Source** (8) | `abap_get_source`, `abap_set_source`, `abap_edit_method`, `abap_set_class_include`, `abap_get_class_include`, `abap_pretty_print`, `abap_revisions`, `abap_get_function_group` | Read/write source for any object type; surgically edit a single method without touching the rest; write a specific class include (definitions, implementations, macros, testclasses); read class-local includes (CCDEF/CCIMP/CCMAC/CCAU — incl. RAP behavior handler bodies); format via SAP Pretty Printer; revision history; fetch a whole function group (top include, user includes, all FMs) in one call. |
| **Objects** (6) | `abap_create`, `abap_delete`, `abap_activate`, `abap_activate_batch`, `abap_search`, `abap_object_info` | Full object lifecycle. Create in $TMP or real packages (BDEF supported). Delete, activate single or in batch, search by name pattern (trailing wildcards only), get metadata (package, transport layer, active/inactive status, upgrade flag). |
| **Transports** (14) | `transport_create`, `transport_check`, `transport_assign`, `transport_release`, `transport_list`, `transport_info`, `transport_contents`, `transport_delete`, `transport_set_owner`, `transport_add_user`, `transport_set_description`, `transport_log`, `transport_find`, `transport_bundle_into_toc` | Full SE09/SE10 workflow: create requests (incl. clean Transport of Copies via FM TR_INSERT_NEW_COMM), check transport requirements, assign objects via no-op save, release with pre-release inactive-objects check and optional auto-activation, list open requests, per-object assignment info, request contents (E071), delete, change owner, add users, set description, read CTS import/activation logs on any system in the landscape, search E07T by description fragment, and copy E071/E071K rows from source transports into a ToC (point-fix snapshot pattern). |
| **Quality** (6) | `abap_syntax_check`, `abap_atc_run`, `abap_atc_variants`, `abap_where_used`, `abap_find_definition`, `abap_fix_proposals` | Syntax check with errors/warnings; ATC runs with variant diagnostics and silent-fallback detection; where-used lists (incl. class methods via `CLASS::METHOD`); jump to definition at a source position; ADT quick-fix proposals for syntax errors. |
| **Data** (2) | `abap_table`, `abap_query` | Read tables/CDS views with WHERE/LIKE/BETWEEN. Execute OpenSQL queries. |
| **Run** (3) | `abap_run`, `abap_fetch_page`, `abap_unlock` | Create a temp class in $TMP, run code via IF_OO_ADT_CLASSRUN, capture output, clean up. Auto-detects ~run vs ~main across SAP releases. Large outputs are paginated — fetch continuation pages with `abap_fetch_page`. Release SM12 enqueue locks left behind by crashed operations. |
| **Unit tests** (2) | `abap_unit_test`, `abap_create_test_include` | Run ABAP Unit tests with per-method failure detail (assertion message, stack trace); scaffold a test class include (CCAU) for an existing class. |
| **System** (6) | `login`, `healthcheck`, `abap_get_dump`, `abap_inactive_objects`, `abap_annotation_defs`, `raw_http` | Session management, connectivity + SAP_BASIS release check, ST22 short dumps, list inactive objects, CDS annotation definitions, raw ADT HTTP for anything not covered by dedicated tools (SITO, SICF, ...). |
| **DDIC** (2) | `ddic_element`, `ddic_references` | DDIC metadata for CDS views/data elements (fields, types, key flags, labels, annotations, association targets); list all objects referencing a CDS entity or data element. |
| **RAP** (2) | `rap_binding_details`, `rap_publish_binding` | Inspect published OData service bindings (service URL, entity sets, navigation properties); publish/unpublish bindings. |
| **RFC** (2) | `abap_rfc_call`, `abap_ddic_create` | Call RFC-enabled function modules directly via SAP NW RFC (pyrfc-based); create DDIC structures/tables via RFC (requires ZFM_DDIC_CREATE on the target system). |
| **Traces** (8) | `traces_list`, `traces_set_parameters`, `traces_create_config`, `traces_hit_list`, `traces_statements`, `traces_db_access`, `traces_delete`, `traces_delete_config` | Runtime tracing (SAT-style): create trace configurations, set parameters, capture runs, and analyze hit lists, statement-level detail, and DB access; delete run results and configurations. |
| **Debugger** (13) | `debuggerListen`, `debuggerListeners`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, `debuggerSetVariableValue`, `debuggerSaveSettings` | Full remote debugging: register a debug listener, set/delete breakpoints (incl. conditional), attach to a debuggee, read the call stack, inspect variables (with structure/table drill-down), step (into/over/return/continue/terminate), switch stack frames, and change variable values at runtime. |
| **Refactoring** (6) | `renameEvaluate`, `renamePreview`, `renameExecute`, `extractMethodEvaluate`, `extractMethodPreview`, `extractMethodExecute` | Server-side refactorings: rename a symbol across all where-used objects (evaluate → preview → execute), and extract a source range into a new method (evaluate → preview → execute). |
| **BSP / UI5** (3) | `bsp_read_file`, `bsp_search_content`, `ui5_app_index_lookup` | Read files from BSP/UI5 applications or list an app's filetree; search a string across an app's text files (find the file owning a component ID or OData service); look up UI5 Application Index metadata (component ID → BSP app, libraries, timestamps). |
| **Git** (2) | `git_repos`, `git_pull` | gCTS repository listing and pull (imports commits into the SAP system). |

### MCP Prompts

Four ready-made prompt templates are registered alongside the tools:

- **`fix-atc`** — Run ATC on an object, read all P1 findings, fix each one, activate.
- **`transport-review`** — List transport contents, syntax-check all objects, report issues.
- **`class-overview`** — Compact class interface summary plus where-used count.
- **`release-transport`** — Check, syntax-validate, then release a transport.

## Quick Start

### Prerequisites

- Node.js 18+
- Access to an SAP system with ADT enabled (port 44300)
- SAP user with development authorization
- *(optional)* Python 3 + [pyrfc](https://pypi.org/project/pyrfc/) — only needed for `abap_rfc_call` / `abap_ddic_create`; `abap_ddic_create` additionally requires the `ZFM_DDIC_CREATE` function module (RFC-enabled) on the target system

### Install

```bash
git clone https://github.com/DassianInc/dassian-adt.git
cd dassian-adt
npm install
npm run build
```

### Configure

This repository holds **no credentials and no connection data**. All SAP connection settings are supplied by the MCP client at launch time via environment variables — see the next section for concrete examples.

| Env Var | Required | Description |
|---------|----------|-------------|
| `SAP_URL` | yes (single-system) | `https://your-sap-server:44300` |
| `SAP_USER` / `SAP_PASSWORD` | yes (single-system) | Basic-auth credentials |
| `SAP_CLIENT` / `SAP_LANGUAGE` | no | Logon client (e.g. `100`) and language (default `EN`) |
| `SAP_SYSTEMS` | multi-system | JSON array of system configs: `[{"id":"DEV","url":"...","user":"...","password":"...","client":"100","language":"EN"}]` |
| `SAP_DEFAULT_SYSTEM` | no | Default system id (first entry if omitted) |
| `SAP_SYSTEMS_FILTER` | no | Comma-separated system ids to include |
| `SAP_LANDSCAPE_URL` / `SAP_LANDSCAPE_FILE` | no | Landscape definition (URL or `@file`) for multi-system discovery |
| `RFC_PROXY_URL` / `RFC_PROXY_ENABLED` | no | Legacy (SAP_BASIS ≤ 731) transport RFC proxy — see `rfc-proxy/` |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | no | Only for self-signed certificates (dev) |

Without any credentials the server fails fast with `SAP_URL is required.` — nothing is baked in.

### Connect to Your MCP Client

Works with any MCP client (ZCode, Claude Code, Cline, Cursor, Claude Desktop). The client passes the credentials as environment variables when launching the server — for example the workspace `.mcp.json`:

```json
{
  "mcpServers": {
    "abap": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": {
        "SAP_URL": "https://your-sap-server:44300",
        "SAP_USER": "YOUR_USER",
        "SAP_PASSWORD": "YOUR_PASSWORD",
        "SAP_CLIENT": "100",
        "SAP_LANGUAGE": "EN"
      }
    }
  }
}
```

Multiple systems? Add one entry per system:

```json
{
  "mcpServers": {
    "abap-dev": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": { "SAP_URL": "https://dev-system:44300", "SAP_USER": "...", "SAP_PASSWORD": "..." }
    },
    "abap-qa": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": { "SAP_URL": "https://qa-system:44300", "SAP_USER": "...", "SAP_PASSWORD": "..." }
    }
  }
}
```

### HTTP Mode (Team Deployment)

For team-wide access, run the server as a centralized HTTP service:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 \
  SAP_URL=https://your-sap-server:44300 \
  SAP_USER=SERVICE_USER \
  SAP_PASSWORD=... \
  node dist/index.js
```

Each client gets its own MCP session (and SAP session). Health check at `http://your-server:3000/health`.

Connect from Claude Code using the remote URL:

```json
{
  "mcpServers": {
    "abap": {
      "type": "url",
      "url": "http://your-server:3000/mcp"
    }
  }
}
```

Or register as a team integration on claude.ai for the whole org.

| Env Var | Default | Description |
|---------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` (local) or `http` (remote) |
| `MCP_HTTP_PORT` | `3000` | HTTP server port |
| `MCP_HTTP_PATH` | `/mcp` | MCP endpoint path |

### Test

```bash
npm test              # 260 unit tests, <10 seconds, no SAP needed
npm run test:live     # Integration tests against live SAP (needs env vars)
npm run test:e2e      # Write-path lifecycle test (create -> write -> activate -> delete)
```

## Typical Workflows

The server is workflow-oriented: most tools complete their lock → write → unlock cycle atomically, so the AI orchestrates at task level instead of managing ADT primitives.

### 1. Change existing code

```
abap_get_source (compact=true for classes)
  → abap_edit_method (surgical single-method edit; survives CRLF sources)
  → abap_syntax_check
  → abap_activate
```

`abap_set_source` replaces whole sources and auto-prompts for a transport when the object sits in a non-$TMP package (elicitation).

### 2. New object, end to end

```
transport_create (workbench; or let abap_create auto-generate one)
  → abap_create (type CLAS/PROG/INTF/FUGR/DDLS/BDEF/TABL/TTYP/DEVC..., package, transport)
  → abap_set_source
  → abap_syntax_check → abap_activate → abap_activate_batch (with dependents)
```

### 3. Transport lifecycle

```
transport_check (what transport does this object need?)
  → transport_assign (no-op save mounts object onto the request)
  → transport_contents (review E071)
  → transport_release (pre-checks inactive objects, releases tasks then request, asks for confirmation)
  → transport_log (read the import/activation log on the target system)
```

Point-fix snapshot: `transport_create transportType="toc"` → `transport_bundle_into_toc` copies E071 rows from several source requests into one ToC.

### 4. Create a DDIC table (RFC path)

```
abap_ddic_create (objectType=TABL|STRU, fields with data elements;
                  derives LENG/DECIMALS automatically via ZFM_DDIC_CREATE)
```

### 5. Investigate data

```
ddic_element (structure of a CDS view / data element)
  → abap_table (WHERE clause) or abap_query (full OpenSQL)
  → abap_run (one-off SELECT/report logic; abap_fetch_page for large output)
```

### 6. Remote debugging session

```
debuggerListen (register terminal for user X)
  → debuggerSetBreakpoints
  → (user triggers the process) debuggerAttach
  → debuggerStackTrace → debuggerVariables / debuggerChildVariables
  → debuggerStep (into/over/return/continue), debuggerSetVariableValue
  → debuggerDeleteBreakpoints + debuggerDeleteListener (cleanup)
```

### 7. Refactor

```
renameEvaluate (symbol at uri:line:col) → renamePreview → renameExecute
extractMethodEvaluate (uri + range) → extractMethodPreview → extractMethodExecute
```

Renames propagate across every where-used object in one atomic call; activate afterwards.

### 8. Quality gate (built-in prompts)

- `/fix-atc` — ATC run, fix every P1 finding, activate
- `/transport-review` — contents + syntax-check everything on a request
- `/release-transport` — validate then release
- `/class-overview` — compact interface + where-used summary

## Key Features

### Zero-Crash Input Validation

Centralized validation middleware checks every tool's required parameters before any handler logic runs. Missing `name`? Missing `type`? The error names exactly what's missing. No stack traces, no `Cannot read properties of undefined`.

### MCP Elicitation

When the AI forgets a required parameter, instead of failing, the server asks the user directly:

- **Missing package** on `abap_create` -> "Which package?" form with $TMP default
- **Missing transport** on `abap_set_source` -> "Which transport?" prompt, then retries
- **Transport release** -> "Release D25K900161? This is IRREVERSIBLE" confirmation
- **Leftover class** on `abap_run` -> "Delete ZCL_TMP_ADT_RUN and retry?" prompt
- **Inactive dependents** on `abap_activate` -> "Activate them too?" with list

Falls back gracefully on clients that don't support elicitation.

### Self-Correcting Error Messages

Every SAP error is classified and annotated with actionable hints:

- Locked object -> "Check SM12 for active locks"
- Upgrade mode -> "Run SPAU_ENH to clear the upgrade flag"
- Opaque `I::000` code -> "The URL path is wrong -- check the object type"
- Transport number passed as object name -> "Use transport_contents instead"
- Pipe characters in string templates -> "Escape with \\| or use CONCATENATE"

The AI reads these hints and self-corrects on the next call.

### Automatic Session Recovery

Every ADT call is wrapped in `withSession()`. If the SAP session expires mid-operation, the server re-logs in automatically and retries. Users never see a session timeout.

### SAP Release Detection

`abap_run` auto-detects whether the system uses `IF_OO_ADT_CLASSRUN~run` (<=2023) or `~main` (2024+) by reading the interface source after login. Works on any S/4HANA release without configuration.

### Legacy System Support (SAP_BASIS <= 731)

`healthcheck` reports the target's SAP_BASIS release. On legacy ECC 6.0 systems (BASIS 731 and earlier) program creation and transport creation automatically route through a compatibility layer (`lib/legacyAdt.ts`), optionally backed by the `rfc-proxy` service (see appendix). Modern systems use the standard ADT API untouched.

## Architecture

```
Client (Claude Code, VS Code, etc.)
    |
    | MCP protocol (stdio)
    |
AbapAdtServer (index.ts)
    |
    +-- BaseHandler (session mgmt, validation, elicitation)
    |       |
    |       +-- SourceHandlers    (get/set source, edit method, function groups)
    |       +-- ObjectHandlers    (create, delete, activate, search)
    |       +-- TransportHandlers (create, assign, release, list)
    |       +-- QualityHandlers   (syntax check, ATC, where-used)
    |       +-- DataHandlers      (table read, SQL query)
    |       +-- RunHandlers       (temp class execution, unlock)
    |       +-- SystemHandlers    (login, healthcheck, dumps, raw HTTP)
    |       +-- GitHandlers       (gCTS repos, pull)
    |       +-- TestHandlers      (ABAP Unit tests, test includes)
    |       +-- RapHandlers       (service binding publish/details)
    |       +-- TraceHandlers     (runtime traces)
    |       +-- DdicHandlers      (DDIC metadata, references)
    |       +-- RfcHandlers       (RFC calls, DDIC via RFC)
    |       +-- BspHandlers       (BSP/UI5 files, UI5 app index)
    |       +-- DebugHandlers     (remote ABAP debugging)
    |       +-- RefactorHandlers  (rename, extract-method)
    |
    +-- lib/urlBuilder.ts  (ADT URL construction for 30+ object types)
    +-- lib/errors.ts      (SAP error classification + hints)
    +-- lib/logger.ts      (JSON structured logging)
    +-- lib/legacyAdt.ts   (SAP_BASIS <= 731 compatibility layer)
```

## Appendix: rfc-proxy (optional legacy helper)

`rfc-proxy/` contains a standalone experimental Python service (pyrfc-based) used by the legacy transport path on SAP_BASIS <= 731 systems. The MCP server does not require it on modern systems. It reads its own config — copy `rfc-proxy/config.example.json` to `rfc-proxy/config.json` and fill in your RFC details (that file is gitignored; the repo ships no credentials). Enable via `RFC_PROXY_URL` / `RFC_PROXY_ENABLED`.

`abap_rfc_call` / `abap_ddic_create` do **not** use the proxy — they call `scripts/rfc_call.py` directly and take their connection parameters from the server's environment-injected credentials.

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch
3. Run `npm test` and ensure all tests pass
4. Open a pull request

## Credits

- **[Mario Andreschak](https://github.com/mario-andreschak)** -- original [mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) server scaffold
- **[Marcello Urbani](https://github.com/marcellourbani)** -- [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) library powering all ADT HTTP communication
- **[Dassian Inc.](https://github.com/DassianInc)** -- fork maintainer

## License

MIT -- see [LICENSE](LICENSE).
