import { cookies } from "next/headers";

import { GATE_COOKIE } from "./gate";
import { sessionForToken, type CurrentUser } from "./session";

export async function currentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return sessionForToken(store.get(GATE_COOKIE)?.value);
}
