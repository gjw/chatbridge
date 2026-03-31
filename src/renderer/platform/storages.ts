import localforage from 'localforage'
import { StorageKey } from '@/storage'
import type { Storage } from './interfaces'

export class LocalStorage implements Storage {
  validStorageKeys: string[] = [
    StorageKey.ConfigVersion,
    StorageKey.Configs,
    StorageKey.Settings,
    StorageKey.MyCopilots,
    StorageKey.ChatSessions,
  ]

  public getStorageType(): string {
    return 'LOCAL_STORAGE'
  }

  public async setStoreValue(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value))
  }
  public async getStoreValue(key: string) {
    const json = localStorage.getItem(key)
    return json ? JSON.parse(json) : null
  }
  public async delStoreValue(key: string) {
    return localStorage.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: unknown }> {
    const ret: { [key: string]: unknown } = {}

    for (const key of this.validStorageKeys) {
      const val = localStorage.getItem(key)
      if (val) {
        try {
          ret[key] = JSON.parse(val)
        } catch (error) {
          console.error(`Failed to parse stored value for key "${key}":`, error)
        }
      }
    }

    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return Object.keys(localStorage).filter((k) => this.validStorageKeys.includes(k))
  }
  public async setAllStoreValues(data: { [key: string]: unknown }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

export class IndexedDBStorage implements Storage {
  private store = localforage.createInstance({ name: 'chatboxstore' })

  public getStorageType(): string {
    return 'INDEXEDDB'
  }

  public async setStoreValue(key: string, value: unknown) {
    try {
      await this.store.setItem(key, JSON.stringify(value))
    } catch (error) {
      throw new Error(`Failed to store value for key "${key}": ${(error as Error).message}`)
    }
  }
  public async getStoreValue(key: string) {
    const json = await this.store.getItem<string>(key)
    if (!json) return null
    try {
      return JSON.parse(json)
    } catch (error) {
      console.error(`Failed to parse stored value for key "${key}":`, error)
      return null
    }
  }
  public async delStoreValue(key: string) {
    return await this.store.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: unknown }> {
    const ret: { [key: string]: unknown } = {}
    await this.store.iterate((json, key) => {
      if (typeof json === 'string') {
        try {
          ret[key] = JSON.parse(json)
        } catch (error) {
          console.error(`Failed to parse value for key "${key}":`, error)
          ret[key] = null
        }
      } else {
        ret[key] = null
      }
    })
    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.store.keys()
  }
  public async setAllStoreValues(data: { [key: string]: unknown }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

export function getOldVersionStorages(): Storage[] {
  return [new LocalStorage()]
}
