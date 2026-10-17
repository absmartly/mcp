# Changelog

## 2.1.0 (unreleased)

### Catalog contract

- 23 commands whose documented params did not match the CLI core now document what the core needs: `role` on access grant/revoke, `unitType` on `estimateParticipants`, `oldPassword`/`newPassword` on `resetMyPassword`, top-level filters on insights/activity/events, and more. `refreshFields` is removed. See the 2.1.0 PR for the full table.
- Params the core never reads are deprecated: still accepted, hidden from `get_command_docs`.

### Security

- `FetchHttpClient` only sends requests under `<base>/v1/` or the root `/auth/current-user` paths. Dot segments in any encoding, backslashes, encoded separators, control characters and `undefined`/`null`/`NaN` path segments are refused before `fetch`.
- ABsmartly endpoints are parsed by one function (`parseAbsmartlyEndpoint`) everywhere they enter: OAuth consent, API-key requests, the `/register` link, stored props and `FetchHttpClient`.
- Every argument an APIClient method puts into a request path is checked before the method runs, whichever route it came by (`withPathIdGuard`, applied once where this package creates its client and again in `executeCommand` for a host's own client). Path arguments come from `src/api-path-args.ts`, generated from the `@absmartly/cli` build and looked up by parameter name: an ID must be a positive integer, and a word (uploadFile's `usage`) must not contain `/ \ . % ? #`. `request`/`rawRequest` validate their path (leading `/`, no dot segment in any encoding, no backslash). Any method not in the table fails closed: non-primitive arguments, strings with path characters and numbers that are not positive integers are refused. The `absmartly://<entity>/{id}` resource templates get the same check.
- `@absmartly/cli` is pinned to exactly `1.16.2` (peer and dev dependency; the peer range was `>=1.7.0 <2`), the build the path table was generated from. The installed version is checked at load; on any other version no mapping is trusted and every method is treated as unknown.

### Behaviour changes for direct executeCommand callers

`executeCommand` dispatches 2.0 core-shaped calls as 2.0.1 did. These are the intentional differences, each pinned by `npm run parity:main` (`scripts/parity-main.ts`, `EXPECTED_DIFFERENCES`):

- A path ID that is not a positive integer is an error: `goalId: "1/../users"`, `experimentId: null`, an ID nested in `data` (`{ data: { id: "abc" } }`), and a missing one (2.0.1 sent `/experiments/undefined`).
- `revokeExperimentAccessUser`/`Team` with `role`: the role is resolved to its asset role ID. 2.0.1 ignored `role` and sent `DELETE .../undefined`.
- `listCustomFields` without `type` defaults to `"test"` (2.0.1 filtered on `undefined` and always returned no fields).
- `generateTemplate` without `name`/`type` defaults to `"My Experiment"`/`"test"` (2.0.1 generated a template named `undefined`).
- `platformconfig.getPlatformConfig {id: null}` and `updatePlatformConfig {id, value}` fail as in 2.0.1, with a message naming the config problem.
- ID values are normalised to integers in request bodies and results too (`userIds: ["2"]` sends `user_ids: [2]`; `createAnnotation {experimentId: "5"}` sends `experiment_id: 5`).
- Datasource and storage tests: `datasourceId`/`configId` now test the saved config (2.0.1 ignored them and posted an empty body); `validateDatasourceQuery` with `datasourceId` requires `query`; a call with neither an ID nor `config` is an error.
- `grantExperimentAccessUser {roleId: "Editor"}`: `roleId` must be an asset role ID; pass a name in `role` (2.0.1 sent `asset_role_id: "Editor"`).
- Declared aliases that disagree with their documented param (`roleId` vs `role`/`assetRoleId`, `id` vs the documented ID) are an error; 2.0.1 silently picked one.
