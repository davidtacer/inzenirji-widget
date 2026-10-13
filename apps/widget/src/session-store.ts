import { isTokenFormat } from "@inzenirji/shared";

export interface StoredSession {
  token: string;
  expiresAt: number;
}

export interface SessionStore {
  load(siteId: string): StoredSession | null;
  save(siteId: string, session: StoredSession): void;
  clear(siteId: string): void;
}

const key = (siteId: string) => `inzenirji:session:${siteId}`;

/**
 * Keeps the session in the iframe's localStorage. Browsers partition iframe storage by the top-level site,
 * so the session only exists inside this client's /uredi page. Storage can be unavailable (private mode,
 * blocked site data): every call is wrapped, and the editor then simply asks for a login again.
 */
export function createSessionStore(
  getStorage: () => Storage | null = () => window.localStorage,
  now = Date.now,
) {
  const storage = (): Storage | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };
  const store: SessionStore = {
    load(siteId) {
      try {
        const raw = storage()?.getItem(key(siteId));
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<StoredSession>;
        if (!isTokenFormat(value.token) || typeof value.expiresAt !== "number" || value.expiresAt <= now()) {
          storage()?.removeItem(key(siteId));
          return null;
        }
        return { token: value.token, expiresAt: value.expiresAt };
      } catch {
        return null;
      }
    },
    save(siteId, session) {
      try {
        storage()?.setItem(key(siteId), JSON.stringify(session));
      } catch {
        // storage full or blocked: the session lives only in memory for this visit
      }
    },
    clear(siteId) {
      try {
        storage()?.removeItem(key(siteId));
      } catch {
        // nothing to clear
      }
    },
  };
  return store;
}
