// No-op OAuth hook for open-source edition

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
    loginCallback: null as string | null,
    startLogin: async () => {},
    exchangeCode: async (_code: string) => {},
    startDeviceFlow: async () => {},
    waitForDeviceToken: async () => {},
    cancel: () => {},
    login: async () => {},
    logout: async () => {},
    refresh: async () => {},
    isLoading: false,
    error: null,
  }
}
