package com.khandanirishta.app.core.network

import okhttp3.Interceptor

/** Release builds add no interceptors of their own. */
internal fun buildTypeInterceptors(): List<Interceptor> = emptyList()
