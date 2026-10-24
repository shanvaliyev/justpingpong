import { createAuth as createConfiguredAuth } from "@justpingpong/auth";
import { type Database, createDb } from "@justpingpong/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}

export function createAuth(database: Database = getDb()) {
  return createConfiguredAuth(ENV, database);
}
