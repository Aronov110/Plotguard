import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createSessionManager, type SessionManager, type SessionState } from "./session-manager.ts";

export interface AuthContextValue {
  readonly state: SessionState;
  readonly login: SessionManager["login"];
  readonly register: SessionManager["register"];
  /**
   * Signs out on this page at once, then tells the server. Never rejects.
   * @returns whether the server confirmed (see `signOutUnconfirmed`). `false` also covers an
   *   unexpected failure.
   */
  readonly signOut: SessionManager["signOut"];
  /**
   * True after a sign-out that the server did not confirm, until a later sign-out is confirmed or
   * the person logs in again. The page is signed out then, but the login cookie (which the page
   * cannot delete: it is `HttpOnly`) may still be valid, so on a shared computer the person must
   * be told. It lives here, not in a screen, because the screen that asked for the sign-out is
   * gone by the time the answer arrives.
   */
  readonly signOutUnconfirmed: boolean;
  readonly withAuth: SessionManager["withAuth"];
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthProviderProps {
  readonly children: ReactNode;
  /** For tests. Without it the provider creates its own manager. */
  readonly manager?: SessionManager;
}

/** Gives every component below it the login state of this tab, and keeps the login alive. */
export function AuthProvider({ children, manager }: AuthProviderProps): ReactElement {
  const [active] = useState(() => manager ?? createSessionManager());
  const state = useSyncExternalStore(active.subscribe, active.getState, active.getState);
  const [signOutUnconfirmed, setSignOutUnconfirmed] = useState(false);

  // React's StrictMode runs this effect, cleans it up and runs it again while developing. The
  // manager copes: `start` restores the login only once and re-arms the timer that `stop` cancelled.
  useEffect(() => {
    void active.start();
    return () => {
      active.stop();
    };
  }, [active]);

  const login = useCallback<SessionManager["login"]>(
    async (input) => {
      await active.login(input);
      setSignOutUnconfirmed(false);
    },
    [active],
  );

  const register = useCallback<SessionManager["register"]>(
    async (input) => {
      await active.register(input);
      setSignOutUnconfirmed(false);
    },
    [active],
  );

  const signOut = useCallback<SessionManager["signOut"]>(async () => {
    let confirmed = false;
    try {
      confirmed = await active.signOut();
    } catch (error) {
      // An unexpected failure (a bug) is treated like an unreachable server: the page is signed out
      // already, the server may not know, so the warning must show. The cause goes to the console.
      console.error(error);
    }
    setSignOutUnconfirmed(!confirmed);
    return confirmed;
  }, [active]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, register, signOut, signOutUnconfirmed, withAuth: active.withAuth }),
    [state, login, register, signOut, signOutUnconfirmed, active],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The login state and the sign-in, sign-up and sign-out actions. Only works under an AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return value;
}
