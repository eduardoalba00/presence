/** Defaults and identifiers shared across the extension. */

/** WebSocket URL used when `presence.serverUrl` is unset. */
export const DEFAULT_SERVER_URL = "ws://localhost:8080";

/** Custom URI schemes backing the tree's virtual documents and decorations. */
export const DIFF_SCHEME = "presence-diff"; // before/after content for the diff editor
export const FILE_SCHEME = "presence-file"; // file-type icon + status badge on diff rows
export const USER_SCHEME = "presence-user"; // same-file collision badge on user rows

/** Skip shipping/rendering a diff whose two sides exceed this many characters. */
export const MAX_DIFF_CHARS = 400_000;

/** Mark ourselves idle after this long without editor activity. */
export const IDLE_AFTER_MS = 120_000;

/** How often the activity tracker re-evaluates idle state. */
export const ACTIVITY_POLL_MS = 20_000;

/** Debounce window for recomputing our working-tree diff after git changes. */
export const DIFF_DEBOUNCE_MS = 700;

/** Reconnect backoff ceiling. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** View id of the Teammates tree. */
export const ROSTER_VIEW_ID = "presence.roster";

/** Command that focuses the Presence view container (used by the status bar). */
export const FOCUS_VIEW_COMMAND = "workbench.view.extension.presence";

/** Command ids. */
export const OPEN_DIFF_COMMAND = "presence.openDiff";
export const PAUSE_COMMAND = "presence.pause";
export const RESUME_COMMAND = "presence.resume";
export const SET_URL_COMMAND = "presence.setServerUrl";
export const RETRY_ACCESS_COMMAND = "presence.retryAccess";

/** Context keys driving the view's welcome content and title buttons. */
export const PAUSED_CONTEXT = "presence.paused";
export const CONNECTED_CONTEXT = "presence.connected";
/** True when the user could not be confirmed to have access to the repo. */
export const ACCESS_DENIED_CONTEXT = "presence.accessDenied";
