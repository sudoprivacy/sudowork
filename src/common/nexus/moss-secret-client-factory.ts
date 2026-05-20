/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { MossSecretClient } from './moss-secret-client'
import { getAuthToken, getMossServerUrl, getUserId } from '../enterpriseDebugConfig'

let mossClientInstance: MossSecretClient | null = null
let lastToken: string = ''

export function getMossSecretClient(): MossSecretClient {
  const currentToken = getAuthToken()
  if (!mossClientInstance || lastToken !== currentToken) {
    mossClientInstance = new MossSecretClient(
      getMossServerUrl(),
      currentToken,
      getUserId(),
    )
    lastToken = currentToken
  }
  return mossClientInstance
}
