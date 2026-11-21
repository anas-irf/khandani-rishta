package com.khandanirishta.app.core.network

import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.auth.TokenProvider
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import java.util.Locale

/** Platform, build and language headers on every API request (specs/22 section 5.2). */
class AppHeadersInterceptor(
    private val config: AppConfig,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request =
            chain
                .request()
                .newBuilder()
                .header("x-app-platform", "android")
                .header("x-app-version-code", config.versionCode.toString())
                .header("Accept-Language", Locale.getDefault().toLanguageTag())
                .build()
        return chain.proceed(request)
    }
}

/**
 * Adds the Clerk session token. On a `401` it fetches a token with the cache skipped and retries
 * once; a second `401` reaches [ApiCaller], which announces that the session has expired.
 */
class AuthInterceptor(
    private val tokens: TokenProvider,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        if (!needsToken(original)) return chain.proceed(original)

        val token = runBlocking { tokens.token(forceRefresh = false) }
        val response = chain.proceed(original.withToken(token))
        if (response.code != HTTP_UNAUTHORIZED || token == null) return response

        val fresh = runBlocking { tokens.token(forceRefresh = true) } ?: return response
        response.close()
        return chain.proceed(original.withToken(fresh))
    }

    private fun Request.withToken(token: String?): Request =
        if (token == null) this else newBuilder().header("Authorization", "Bearer $token").build()

    private fun needsToken(request: Request): Boolean {
        val path = request.url.encodedPath
        return !(path.startsWith("/v1/meta") || path.startsWith("/v1/reference/") || path == "/healthz")
    }

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
    }
}
