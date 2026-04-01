import { createStore, useStore } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { AuthTokens } from '../routes/settings/provider/chatbox-ai/-components/types'

export interface PlatformUser {
  id: string
  email: string
  name: string
  role: 'student' | 'teacher' | 'admin'
}

interface AuthTokensState {
  accessToken: string | null
  refreshToken: string | null
  user: PlatformUser | null
}

interface AuthTokensActions {
  setTokens: (tokens: AuthTokens) => void
  clearTokens: () => void
  getTokens: () => AuthTokens | null
  setUser: (user: PlatformUser) => void
  clearUser: () => void
  loginComplete: (tokens: AuthTokens, user: PlatformUser) => void
  logout: () => void
}

const initialState: AuthTokensState = {
  accessToken: null,
  refreshToken: null,
  user: null,
}

export const authInfoStore = createStore<AuthTokensState & AuthTokensActions>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        ...initialState,

        setTokens: (tokens: AuthTokens) => {
          set((state) => {
            state.accessToken = tokens.accessToken
            state.refreshToken = tokens.refreshToken
          })
        },

        clearTokens: () => {
          set((state) => {
            state.accessToken = null
            state.refreshToken = null
          })
        },

        getTokens: () => {
          const state = get()
          if (state.accessToken && state.refreshToken) {
            return {
              accessToken: state.accessToken,
              refreshToken: state.refreshToken,
            }
          }
          return null
        },

        setUser: (user: PlatformUser) => {
          set((state) => {
            state.user = user
          })
        },

        clearUser: () => {
          set((state) => {
            state.user = null
          })
        },

        loginComplete: (tokens: AuthTokens, user: PlatformUser) => {
          set((state) => {
            state.accessToken = tokens.accessToken
            state.refreshToken = tokens.refreshToken
            state.user = user
          })
        },

        logout: () => {
          set((state) => {
            state.accessToken = null
            state.refreshToken = null
            state.user = null
          })
        },
      })),
      {
        name: 'chatbridge-auth',
        version: 1,
        partialize: (state) => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          user: state.user,
        }),
      }
    )
  )
)

export function useAuthInfoStore<U>(selector: Parameters<typeof useStore<typeof authInfoStore, U>>[1]) {
  return useStore<typeof authInfoStore, U>(authInfoStore, selector)
}

export const useAuthTokens = () => {
  return useAuthInfoStore((state) => ({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    setTokens: state.setTokens,
    clearTokens: state.clearTokens,
    getTokens: state.getTokens,
  }))
}

export const useCurrentUser = () => {
  return useAuthInfoStore((state) => state.user)
}

export const useIsAuthenticated = () => {
  return useAuthInfoStore((state) => state.accessToken !== null)
}
