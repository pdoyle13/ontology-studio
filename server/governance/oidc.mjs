// OIDC bearer verification: when OIDC_JWKS_URL is configured, JWTs on the
// Authorization header are verified against the issuer's JWKS and mapped to a
// governance user by preferred_username / email / sub. Unknown subjects act
// as viewers — visibility without write power.

import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createOidcVerifier({
  jwksUrl = process.env.OIDC_JWKS_URL,
  issuer = process.env.OIDC_ISSUER,
  audience = process.env.OIDC_AUDIENCE,
} = {}) {
  if (!jwksUrl) return null;
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return {
    async verify(token) {
      const opts = {};
      if (issuer) opts.issuer = issuer;
      if (audience) opts.audience = audience;
      const { payload } = await jwtVerify(token, jwks, opts);
      return {
        subject: String(payload.preferred_username ?? payload.email ?? payload.sub ?? ''),
        claims: payload,
      };
    },
  };
}
