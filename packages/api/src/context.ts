import type { Session } from "@justpingpong/auth";
import type { Database } from "@justpingpong/db";

export type Context = {
  session: Session | null;
  db: Database;
};
