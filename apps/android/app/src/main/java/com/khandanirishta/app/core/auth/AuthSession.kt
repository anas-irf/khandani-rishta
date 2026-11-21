package com.khandanirishta.app.core.auth

import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Supplies Clerk session tokens to the API client and the realtime socket. */
interface TokenProvider {
    /** A session token, or `null` when there is no session. [forceRefresh] skips the SDK cache. */
    suspend fun token(forceRefresh: Boolean = false): String?
}

/**
 * The app's view of the Clerk session (specs/06 section 4). Clerk holds the tokens; the app never
 * stores them (specs/22 section 1, principle 4).
 */
@Singleton
class AuthSession
    @Inject
    constructor() : TokenProvider {
        /** True once the Clerk SDK has loaded its configuration and restored any session. */
        val isInitialized: StateFlow<Boolean> get() = Clerk.isInitialized

        /** The SDK's initialisation error, for example a wrong publishable key. */
        val initializationError: StateFlow<Throwable?> get() = Clerk.initializationError

        /** Whether a session is active, updated when the member signs in or out. */
        val signedIn: Flow<Boolean> = Clerk.sessionFlow.map { it != null }.distinctUntilChanged()

        val isSignedIn: Boolean get() = Clerk.session != null

        override suspend fun token(forceRefresh: Boolean): String? {
            if (Clerk.session == null) return null
            return when (val result = Clerk.auth.getToken(GetTokenOptions(skipCache = forceRefresh))) {
                is ClerkResult.Success -> result.value
                is ClerkResult.Failure -> null
            }
        }

        /** Ends the Clerk session on this device. Failures are ignored: the local session ends anyway. */
        suspend fun signOut() {
            runCatching { Clerk.auth.signOut() }
        }
    }
