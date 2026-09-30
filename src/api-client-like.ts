import type { APIClient } from "@absmartly/cli/api-client";

/**
 * The public surface of @absmartly/cli's APIClient, without its private
 * fields. APIClient is a class with private members, so TypeScript treats two
 * installed copies of @absmartly/cli (a host's and this package's) as
 * unrelated types even when they are identical. Typing the handler's client
 * structurally lets a host pass its own APIClient instance, from any
 * @absmartly/cli version in the supported peer range, without a cast.
 */
export type ApiClientLike = Pick<APIClient, keyof APIClient>;
