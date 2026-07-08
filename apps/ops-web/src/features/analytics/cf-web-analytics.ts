// apps/ops-web/src/features/analytics/cf-web-analytics.ts
// Cloudflare Web Analytics beacon, self-hosted in the root layout <head> as
// part of the SERVER-RENDERED tree. Cloudflare's automatic injection placed
// beacon.min.js as the last child of <body> AFTER the HTML left the origin --
// a node React 19 never rendered server-side -> hydration mismatch (#418).
// Rendering it ourselves via next/script (afterInteractive) makes it part of
// the tree the client expects, so hydration matches. Absent token -> null, so
// dev/CI inject nothing. The token is public (ships to the browser anyway).
export interface CfBeaconScriptProps {
  readonly src: 'https://static.cloudflareinsights.com/beacon.min.js';
  readonly strategy: 'afterInteractive';
  readonly 'data-cf-beacon': string;
}

export function cfBeaconScriptProps(
  token: string | undefined,
): CfBeaconScriptProps | null {
  if (token === undefined || token.length === 0) return null;
  return {
    src: 'https://static.cloudflareinsights.com/beacon.min.js',
    strategy: 'afterInteractive',
    'data-cf-beacon': JSON.stringify({ token }),
  };
}
