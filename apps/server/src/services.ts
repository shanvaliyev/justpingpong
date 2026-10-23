import { createAuth as createConfiguredAuth } from "@justpingpong/auth";
import { type Database, createDb } from "@justpingpong/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
