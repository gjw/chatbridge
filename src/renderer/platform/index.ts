import type { Platform } from './interfaces'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }
  return new WebPlatform()
}

export default initPlatform()
