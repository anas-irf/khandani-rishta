package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.core.network.generated.model.BootstrapIncomeBand

/**
 * The income picker's currency (07 section 7.2, 05 section 10.3): chosen from the country of
 * residence, falling back to USD.
 */
object IncomeCurrency {
    private const val FALLBACK = "USD"

    private val countryCurrency =
        mapOf(
            "PK" to "PKR",
            "US" to "USD",
            "GB" to "GBP",
            "AE" to "AED",
            "SA" to "SAR",
            "CA" to "CAD",
            "AU" to "AUD",
            "QA" to "AED",
            "KW" to "AED",
            "OM" to "AED",
            "BH" to "AED",
        )

    private val euroCountries = setOf("DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "PT", "GR", "FI")

    fun forCountry(countryCode: String?): String =
        when {
            countryCode == null -> FALLBACK
            countryCode in euroCountries -> "EUR"
            else -> countryCurrency[countryCode] ?: FALLBACK
        }

    /** Currencies present in the bands, in order of first appearance. */
    fun currencies(bands: List<BootstrapIncomeBand>): List<String> = bands.map { it.currencyCode }.distinct()

    /**
     * The currency the list opens in: the saved band's currency (rule 5), otherwise the country's,
     * or USD when that currency has no bands (rule 2).
     */
    fun initial(
        bands: List<BootstrapIncomeBand>,
        countryCode: String?,
        savedBandCode: String?,
    ): String {
        bands.firstOrNull { it.code == savedBandCode }?.let { return it.currencyCode }
        val currency = forCountry(countryCode)
        return if (bands.any { it.currencyCode == currency }) currency else FALLBACK
    }
}
