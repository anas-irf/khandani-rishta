package com.khandanirishta.app.core.data

import android.content.Context
import com.khandanirishta.app.core.network.ApiCaller
import com.khandanirishta.app.core.network.generated.api.ReferenceApi
import com.khandanirishta.app.core.network.generated.model.CityRef
import com.khandanirishta.app.core.network.generated.model.ReferenceBootstrap
import com.khandanirishta.app.core.network.generated.model.RegionItem
import com.khandanirishta.app.core.network.serialization.ApiJson
import com.khandanirishta.app.core.network.serialization.WireEnum
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.create
import retrofit2.http.GET
import retrofit2.http.Header
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** One choice of a closed list or lookup table, already in the display language. */
data class Option(
    val code: String,
    val label: String,
)

/**
 * Labels and choices from the reference bootstrap (specs/15 section 5, specs/17 section 8.4).
 * An unknown code renders as the code with underscores replaced by spaces, so a newer API value
 * never breaks an older app.
 */
class Reference(
    val data: ReferenceBootstrap,
    private val urdu: Boolean = false,
) {
    private fun pick(
        english: String,
        urduText: String?,
    ): String = if (urdu && !urduText.isNullOrBlank()) urduText else english

    private val optionLists: Map<String, List<Option>> =
        data.options.mapValues { (_, items) -> items.map { Option(it.code, pick(it.label, it.labelUr)) } }

    private val religions = data.religions.associateBy { it.code }
    private val sects = data.religions.flatMap { it.sects }.associateBy { it.code }
    private val castes = data.castes.associateBy { it.code }
    private val subCastes = data.castes.flatMap { it.subCastes }.associateBy { it.code }
    private val languages = data.languages.associateBy { it.code }
    private val educationLevels = data.educationLevels.associateBy { it.code }
    private val educationFields = data.educationFields.associateBy { it.code }
    private val professions = data.professionCategories.associateBy { it.code }
    private val incomeBands = data.incomeBands.associateBy { it.code }
    private val hobbies = data.hobbies.associateBy { it.code }
    private val countries = data.countries.associateBy { it.code }

    /** The choices of a closed list such as `marital_status`, in the API's order. */
    fun options(list: String): List<Option> = optionLists[list].orEmpty()

    /** The label of a code of a closed list. */
    fun option(
        list: String,
        code: String?,
    ): String {
        if (code.isNullOrEmpty()) return ""
        return optionLists[list]?.firstOrNull { it.code == code }?.label ?: fallback(code)
    }

    fun option(
        list: String,
        value: WireEnum?,
    ): String = option(list, value?.wire)

    /** Choices for an enumeration, restricted to the codes this build can send. */
    fun <E> optionsOf(
        list: String,
        values: List<E>,
    ): List<Pair<E, String>> where E : Enum<E>, E : WireEnum =
        options(list).mapNotNull { option ->
            values.firstOrNull { it.wire == option.code && it.wire.isNotEmpty() }?.let { it to option.label }
        }

    fun religion(code: String?): String = name(code) { religions[it]?.let { r -> pick(r.name, r.nameUr) } }

    fun sect(code: String?): String = name(code) { sects[it]?.let { s -> pick(s.name, s.nameUr) } }

    fun caste(code: String?): String = name(code) { castes[it]?.let { c -> pick(c.name, c.nameUr) } }

    fun subCaste(code: String?): String = name(code) { subCastes[it]?.let { s -> pick(s.name, s.nameUr) } }

    fun language(code: String?): String = name(code) { languages[it]?.let { l -> pick(l.name, l.nameUr) } }

    fun educationLevel(code: String?): String = name(code) { educationLevels[it]?.let { e -> pick(e.name, e.nameUr) } }

    fun educationField(code: String?): String = name(code) { educationFields[it]?.let { e -> pick(e.name, e.nameUr) } }

    fun profession(code: String?): String = name(code) { professions[it]?.let { p -> pick(p.name, p.nameUr) } }

    fun incomeBand(code: String?): String = name(code) { incomeBands[it]?.let { b -> pick(b.label, b.labelUr) } }

    fun hobby(code: String?): String = name(code) { hobbies[it]?.let { h -> pick(h.name, h.nameUr) } }

    fun country(code: String?): String = name(code) { countries[it]?.let { c -> pick(c.name, c.nameUr) } }

    fun dialCode(countryCode: String?): String? = countryCode?.let { countries[it]?.dialCode }

    fun religionOptions(): List<Option> = data.religions.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun sectOptions(religionCodes: Collection<String>): List<Option> =
        data.religions
            .filter { religionCodes.isEmpty() || it.code in religionCodes }
            .flatMap { religion -> religion.sects.map { Option(it.code, pick(it.name, it.nameUr)) } }

    fun casteOptions(): List<Option> = data.castes.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun subCasteOptions(casteCode: String?): List<Option> =
        castes[casteCode]?.subCastes?.map { Option(it.code, pick(it.name, it.nameUr)) }.orEmpty()

    /** Aliases of each caste, so a search for "Rajpoot" finds "Rajput". */
    fun casteAliases(code: String): List<String> = castes[code]?.aliases.orEmpty()

    fun languageOptions(): List<Option> = data.languages.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun countryOptions(): List<Option> = data.countries.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun educationLevelOptions(): List<Option> =
        data.educationLevels.sortedBy { it.rank }.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun educationFieldOptions(): List<Option> = data.educationFields.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun professionOptions(): List<Option> = data.professionCategories.map { Option(it.code, pick(it.name, it.nameUr)) }

    fun hobbyOptions(): List<Pair<String, List<Option>>> =
        data.hobbies
            .groupBy { it.category }
            .map { (category, items) -> category to items.map { Option(it.code, pick(it.name, it.nameUr)) } }

    /** Income bands of one currency, by rank. */
    fun incomeBandOptions(currencyCode: String): List<Option> =
        data.incomeBands
            .filter { it.currencyCode == currencyCode }
            .sortedBy { it.rank }
            .map { Option(it.code, pick(it.label, it.labelUr)) }

    /** Distinct education ranks with the first level name of each, for "at least" choices. */
    fun educationRanks(): List<Pair<Int, String>> =
        data.educationLevels
            .sortedBy { it.rank }
            .distinctBy { it.rank }
            .map { it.rank to pick(it.name, it.nameUr) }

    /** Distinct PKR income ranks for "at least" choices. */
    fun incomeRanks(): List<Pair<Int, String>> =
        data.incomeBands
            .filter { it.currencyCode == "PKR" }
            .sortedBy { it.rank }
            .distinctBy { it.rank }
            .map { it.rank to pick(it.label, it.labelUr) }

    private inline fun name(
        code: String?,
        lookup: (String) -> String?,
    ): String {
        if (code.isNullOrEmpty()) return ""
        return lookup(code) ?: fallback(code)
    }

    companion object {
        fun fallback(code: String): String = code.replace('_', ' ')
    }
}

/** `GET /v1/reference/bootstrap` with `If-None-Match`, which the contract does not declare. */
private interface ReferenceCacheApi {
    @GET("v1/reference/bootstrap")
    suspend fun bootstrap(
        @Header("If-None-Match") etag: String?,
    ): Response<ReferenceBootstrap>
}

@Serializable
private data class CachedBootstrap(
    val etag: String,
    val data: ReferenceBootstrap,
)

/**
 * Holds the reference bootstrap. It is stored in the app's private files with its version and
 * revalidated with `If-None-Match` at every start (specs/22 section 6). Reference data is the only
 * API data the app writes to disk.
 */
@Singleton
class ReferenceRepository
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
        retrofit: Retrofit,
        private val api: ReferenceApi,
        private val caller: ApiCaller,
    ) {
        private val cacheApi: ReferenceCacheApi = retrofit.create()
        private val file: File get() = File(context.filesDir, "reference_bootstrap.json")
        private val mutex = Mutex()
        private val state = MutableStateFlow<Reference?>(null)

        /** The loaded reference data, or `null` until the first load. */
        val reference: StateFlow<Reference?> = state.asStateFlow()

        private var revalidated = false
        private var etag: String? = null

        /** Loads from disk at once, then revalidates with the API once per process. */
        suspend fun load(): Result<Reference> =
            mutex.withLock {
                if (state.value == null) {
                    readCache()?.let { cached ->
                        state.value = Reference(cached.data)
                        etag = cached.etag
                    }
                }
                if (revalidated) state.value?.let { return@withLock Result.success(it) }
                val response =
                    try {
                        cacheApi.bootstrap(etag.takeIf { state.value != null })
                    } catch (io: IOException) {
                        return@withLock state.value?.let { Result.success(it) } ?: Result.failure(io)
                    }
                val body = response.body()
                val current = state.value
                when {
                    response.code() == NOT_MODIFIED && current != null -> {
                        revalidated = true
                        Result.success(current)
                    }

                    response.isSuccessful && body != null -> {
                        val tag = response.headers()["ETag"] ?: "\"${body.version}\""
                        writeCache(CachedBootstrap(tag, body))
                        etag = tag
                        revalidated = true
                        Reference(body).also { state.value = it }.let { Result.success(it) }
                    }

                    else -> {
                        state.value?.let { Result.success(it) }
                            ?: Result.failure(IOException("reference bootstrap failed: ${response.code()}"))
                    }
                }
            }

        suspend fun regions(countryCode: String): Result<List<RegionItem>> =
            caller.call { api.regions(countryCode = countryCode) }.map { it.items }

        suspend fun cities(
            countryCode: String,
            regionId: Int? = null,
            query: String? = null,
            limit: Long = 30,
        ): Result<List<CityRef>> =
            caller
                .call { api.cities(countryCode = countryCode, regionId = regionId, q = query, limit = limit) }
                .map { it.items }

        private suspend fun readCache(): CachedBootstrap? =
            withContext(Dispatchers.IO) {
                runCatching {
                    if (!file.exists()) return@runCatching null
                    ApiJson.decodeFromString(CachedBootstrap.serializer(), file.readText())
                }.getOrNull()
            }

        private suspend fun writeCache(value: CachedBootstrap) =
            withContext(Dispatchers.IO) {
                runCatching { file.writeText(ApiJson.encodeToString(CachedBootstrap.serializer(), value)) }
            }

        private companion object {
            const val NOT_MODIFIED = 304
        }
    }
