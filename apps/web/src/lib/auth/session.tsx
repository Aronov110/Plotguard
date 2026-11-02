import {
  createContext,
  type ReactElement,
  type ReactNode,
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
  readonly signOut: SessionManager["signOut"];
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

  // React's StrictMode runs this effect, cleans it up and runs it again while developing. The
  // manager copes: `start` restores the login only once and re-arms the timer that `stop` cancelled.
  useEffect(() => {
    void active.start();
    return () => {
      active.stop();
    };
  }, [active]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: active.login,
      register: active.register,
      signOut: active.signOut,
      withAuth: active.withAuth,
    }),
    [state, active],
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
