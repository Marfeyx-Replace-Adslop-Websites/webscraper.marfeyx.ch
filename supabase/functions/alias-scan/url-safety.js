/** @param {string} hostname */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return true;
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(host)) return true;
  const ipv4 = host.match(/^172\.(\d+)\./);
  if (ipv4 && Number(ipv4[1]) >= 16 && Number(ipv4[1]) <= 31) return true;
  if (host.includes(":") && /^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  return false;
}
