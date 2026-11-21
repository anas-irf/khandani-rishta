package com.khandanirishta.app.core.network

import com.khandanirishta.app.core.telemetry.ErrorReporter
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.SerializationException
import retrofit2.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/** App-wide reactions to API failures (specs/22 section 5.3). */
sealed interface ApiSignal {
    /** A gate error code: fetch `GET /v1/me` again and let the gate decide. */
    data class GateCode(
        val code: String,
    ) : ApiSignal

    /** The API refused the session twice: the member must sign in again. */
    data object SessionExpired : ApiSignal

    /** `426 upgrade_required`: this build is no longer supported. */
    data class UpgradeRequired(
        val downloadUrl: String?,
    ) : ApiSignal
}

@Singleton
class ApiSignals
    @Inject
    constructor() {
        private val signals = MutableSharedFlow<ApiSignal>(extraBufferCapacity = 16)
        val flow: SharedFlow<ApiSignal> = signals.asSharedFlow()

        fun emit(signal: ApiSignal) {
            signals.tryEmit(signal)
        }
    }

/**
 * Runs Retrofit calls and turns every outcome into a [Result]: the body on success, an
 * [ApiException] with the parsed [ApiError] otherwise. Gate codes, a dead session and
 * `upgrade_required` are also announced on [ApiSignals], so no screen handles them itself.
 */
@Singleton
class ApiCaller
    @Inject
    constructor(
        private val signals: ApiSignals,
        private val errorReporter: ErrorReporter,
    ) {
        suspend fun <T> call(block: suspend () -> Response<T>): Result<T> {
            val response =
                try {
                    block()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (io: IOException) {
                    return Result.failure(ApiException(ApiError.network(io), io))
                } catch (bad: SerializationException) {
                    errorReporter.report(bad)
                    return Result.failure(ApiException(ApiError.unreadable(200, null), bad))
                }
            if (response.isSuccessful) {
                @Suppress("UNCHECKED_CAST")
                return Result.success(response.body() ?: Unit as T)
            }
            val error = ApiError.from(response)
            announce(error)
            return Result.failure(ApiException(error))
        }

        private fun announce(error: ApiError) {
            when {
                error.code in ErrorCode.GATE_CODES -> {
                    signals.emit(ApiSignal.GateCode(error.code))
                }

                error.code == ErrorCode.UNAUTHENTICATED -> {
                    signals.emit(ApiSignal.SessionExpired)
                }

                error.code == ErrorCode.UPGRADE_REQUIRED -> {
                    signals.emit(ApiSignal.UpgradeRequired(error.detailString("download_url")))
                }

                error.status >= 500 || error.code == ErrorCode.UNREADABLE -> {
                    errorReporter.reportApiError(error)
                }
            }
        }
    }
