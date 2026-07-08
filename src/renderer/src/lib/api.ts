import type { Api } from '../../../shared/types'

/**
 * Single cast point for `window.api`. Preload types it as `unknown` until the
 * main/preload contract lands; renderer code always imports `api` from here
 * instead of touching `window.api` directly.
 */
export const api = window.api as unknown as Api
