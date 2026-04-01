// No-op OAuth hook for open-source edition

interface OAuthResult {
  success: boolean
  error?: string
}

interface OAuthStartResult extends OAuthResult {
  authUrl?: string
  instructions?: string
}

interface OAuthDeviceResult extends OAuthResult {
  userCode?: string
  verificationUri?: string
}

export function useOAuth(
  _providerId: string | undefined,
  _oauthProviderInfo?: unknown,
  _oauthSettingsProviderId?: string,
  _fallbackProviderId?: string
) {
  return {
    isDesktop: false,
    hasOAuth: false,
    isOAuthActive: false,
    isOAuthExpired: false,
    flowType: null as string | null,
    loginCallback: null as (() => Promise<OAuthResult>) | null,
    startLogin: async (): Promise<OAuthStartResult> => ({ success: false, error: 'OAuth not available' }),
    exchangeCode: async (_code: string): Promise<OAuthResult> => ({ success: false, error: 'OAuth not available' }),
    startDeviceFlow: async (): Promise<OAuthDeviceResult> => ({ success: false, error: 'OAuth not available' }),
    waitForDeviceToken: async (): Promise<OAuthResult> => ({ success: false, error: 'OAuth not available' }),
    cancel: () => {},
    login: async () => {},
    logout: async () => {},
    refresh: async () => {},
    isLoading: false,
    error: null,
  }
}
