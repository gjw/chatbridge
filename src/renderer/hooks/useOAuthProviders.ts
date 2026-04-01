// No-op OAuth providers hook for open-source edition

interface OAuthProviderInfo {
  providerId: string
  name: string
}

export function useOAuthProviders(): OAuthProviderInfo[] {
  return []
}
