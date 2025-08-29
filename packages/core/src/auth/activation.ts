/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { Auth } from './auth'
import { LoginManager } from './deprecated/loginManager'
import { fromString } from './providers/credentials'
import { initializeCredentialsProviderManager } from './utils'
import { isAmazonQ, isSageMaker } from '../shared/extensionUtilities'
import { getLogger } from '../shared/logger/logger'
import { getErrorMsg } from '../shared/errors'

import { invokeLambda, patchObject } from '../test/setupUtil'
import { sleep } from '../shared/utilities/timeoutUtils'

export interface SagemakerCookie {
    authMode?: 'Sso' | 'Iam'
}

export async function initialize(loginManager: LoginManager): Promise<void> {
    await sleep(3000)
    getLogger().debug('LAMBDA HAS BEEN CALLEd')
    console.log('AUTH LAMBDA HAS BEEN CALLED')
    registerAuthHook('amazonq-test-account')
    if (isAmazonQ() && isSageMaker()) {
        try {
            // The command `sagemaker.parseCookies` is registered in VS Code Sagemaker environment.
            const result = (await vscode.commands.executeCommand('sagemaker.parseCookies')) as SagemakerCookie
            if (result.authMode !== 'Sso') {
                initializeCredentialsProviderManager()
            }
        } catch (e) {
            const errMsg = getErrorMsg(e as Error)
            if (errMsg?.includes("command 'sagemaker.parseCookies' not found")) {
                getLogger().warn(`Failed to execute command "sagemaker.parseCookies": ${e}`)
            } else {
                throw e
            }
        }
    }
    Auth.instance.onDidChangeActiveConnection(async (conn) => {
        // This logic needs to be moved to `Auth.useConnection` to correctly record `passive`
        if (conn?.type === 'iam' && conn.state === 'valid') {
            await loginManager.login({ passive: true, providerId: fromString(conn.id) })
        } else {
            await loginManager.logout()
        }
    })
}

export function registerAuthHook(secret: string, lambdaId = process.env['AUTH_UTIL_LAMBDA_ARN']) {
    if (lambdaId) {
        const openStub = patchObject(vscode.env, 'openExternal', async (target) => {
            try {
                // Latest eg: 'https://nkomonen.awsapps.com/start/#/device?user_code=JXZC-NVRK'
                const urlString = target.toString(true)

                // Drop the user_code parameter since the auth lambda does not support it yet, and keeping it
                // would trigger a slightly different UI flow which breaks the automation.
                // TODO: If the auth lambda supports user_code in the parameters then we can skip this step
                const verificationUri = urlString.split('?')[0]

                const params = urlString.split('?')[1]
                const userCode = new URLSearchParams(params).get('user_code')

                if (!lambdaId) {
                    throw new Error('AUTH_UTIL_LAMBDA_ARN environment variable is not set')
                }

                await invokeLambda(lambdaId, {
                    secret,
                    userCode,
                    verificationUri,
                })
            } finally {
                openStub.dispose()
            }

            return true
        })
    }
}
