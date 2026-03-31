import type { SearchResult } from '@shared/types'
import { type FetchOptions, ofetch } from 'ofetch'

abstract class WebSearch {
  abstract search(query: string, signal?: AbortSignal): Promise<SearchResult>

  async fetch(url: string, options: FetchOptions) {
    return ofetch(url, options)
  }
}

export default WebSearch
