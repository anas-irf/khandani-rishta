package com.khandanirishta.app.core.network

import okhttp3.Interceptor
import okhttp3.logging.HttpLoggingInterceptor

/** Debug builds log the method, URL, status and timing of each call. Never bodies or headers. */
internal fun buildTypeInterceptors(): List<Interceptor> =
    listOf(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
