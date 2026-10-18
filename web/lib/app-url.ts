// The running Unicess server: Start opens its sign-in, and the agent files live there.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
