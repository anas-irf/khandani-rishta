package com.khandanirishta.app.core.network

import com.khandanirishta.app.core.AppConfig
import com.khandanirishta.app.core.auth.AuthSession
import com.khandanirishta.app.core.auth.TokenProvider
import com.khandanirishta.app.core.network.generated.api.AccountApi
import com.khandanirishta.app.core.network.generated.api.ConnectionsApi
import com.khandanirishta.app.core.network.generated.api.DiscoveryApi
import com.khandanirishta.app.core.network.generated.api.InterestsApi
import com.khandanirishta.app.core.network.generated.api.MetaApi
import com.khandanirishta.app.core.network.generated.api.NotificationsApi
import com.khandanirishta.app.core.network.generated.api.PhotosApi
import com.khandanirishta.app.core.network.generated.api.ProfileApi
import com.khandanirishta.app.core.network.generated.api.ReferenceApi
import com.khandanirishta.app.core.network.generated.api.RelationsApi
import com.khandanirishta.app.core.network.generated.api.VerificationApi
import com.khandanirishta.app.core.network.serialization.ApiJson
import com.khandanirishta.app.core.telemetry.ErrorReporter
import com.khandanirishta.app.core.telemetry.SentryErrorReporter
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.sentry.okhttp.SentryOkHttpInterceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.create
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

/** The client for uploads to presigned R2 URLs: no API headers, no token (specs/22 section 5.1). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UploadClient

/** The client for the realtime socket and member photos: no token interceptor. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class PlainClient

@Module
@InstallIn(SingletonComponent::class)
abstract class NetworkBindings {
    @Binds
    abstract fun tokenProvider(session: AuthSession): TokenProvider

    @Binds
    abstract fun errorReporter(reporter: SentryErrorReporter): ErrorReporter
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun appConfig(): AppConfig = AppConfig.fromBuildConfig()

    @Provides
    @Singleton
    @PlainClient
    fun plainClient(): OkHttpClient =
        OkHttpClient
            .Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

    @Provides
    @Singleton
    fun apiClient(
        @PlainClient plain: OkHttpClient,
        config: AppConfig,
        tokens: TokenProvider,
    ): OkHttpClient =
        plain
            .newBuilder()
            .addInterceptor(AppHeadersInterceptor(config))
            .addInterceptor(AuthInterceptor(tokens))
            .addInterceptor(SentryOkHttpInterceptor(captureFailedRequests = false))
            .apply { buildTypeInterceptors().forEach(::addInterceptor) }
            .build()

    @Provides
    @Singleton
    @UploadClient
    fun uploadClient(
        @PlainClient plain: OkHttpClient,
    ): OkHttpClient =
        plain
            .newBuilder()
            .writeTimeout(120, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

    @Provides
    @Singleton
    fun retrofit(
        client: OkHttpClient,
        config: AppConfig,
    ): Retrofit =
        Retrofit
            .Builder()
            .baseUrl(config.apiBaseUrl + "/")
            .client(client)
            .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
            .build()

    @Provides @Singleton
    fun accountApi(retrofit: Retrofit): AccountApi = retrofit.create()

    @Provides @Singleton
    fun connectionsApi(retrofit: Retrofit): ConnectionsApi = retrofit.create()

    @Provides @Singleton
    fun discoveryApi(retrofit: Retrofit): DiscoveryApi = retrofit.create()

    @Provides @Singleton
    fun interestsApi(retrofit: Retrofit): InterestsApi = retrofit.create()

    @Provides @Singleton
    fun metaApi(retrofit: Retrofit): MetaApi = retrofit.create()

    @Provides @Singleton
    fun notificationsApi(retrofit: Retrofit): NotificationsApi = retrofit.create()

    @Provides @Singleton
    fun photosApi(retrofit: Retrofit): PhotosApi = retrofit.create()

    @Provides @Singleton
    fun profileApi(retrofit: Retrofit): ProfileApi = retrofit.create()

    @Provides @Singleton
    fun referenceApi(retrofit: Retrofit): ReferenceApi = retrofit.create()

    @Provides @Singleton
    fun relationsApi(retrofit: Retrofit): RelationsApi = retrofit.create()

    @Provides @Singleton
    fun verificationApi(retrofit: Retrofit): VerificationApi = retrofit.create()
}
