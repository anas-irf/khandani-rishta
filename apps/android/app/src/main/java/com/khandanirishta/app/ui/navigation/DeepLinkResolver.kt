package com.khandanirishta.app.ui.navigation

import android.net.Uri

/** Where a notification, a push or a link wants to go (specs/16 section 4). */
sealed interface DeepLink {
    /** Open [keys] (in order) on top of [tab]'s root. */
    data class Screen(
        val tab: Tab,
        val keys: List<AppKey>,
    ) : DeepLink

    /** A shared profile code: resolved with `GET /v1/profiles/by-code/{code}`, then `Profile`. */
    data class ProfileCode(
        val code: String,
    ) : DeepLink

    /** A public web page, opened in a Custom Tab (legal and help pages). */
    data class WebPage(
        val path: String,
    ) : DeepLink

    /** An external URL (an announcement with a link). */
    data class External(
        val url: String,
    ) : DeepLink
}

/**
 * Turns push targets, in-app notification targets and App Links into screens (specs/22 section 3.4).
 * The gate check happens afterwards: a target the gate does not allow is dropped.
 */
object DeepLinkResolver {
    /** A target screen ID with its parameters, as carried by pushes and notifications. */
    fun fromTarget(
        target: String,
        params: Map<String, String?>,
    ): DeepLink {
        fun param(name: String): String? = params[name]?.takeIf { it.isNotBlank() }
        val unknown = DeepLink.Screen(Tab.HOME, listOf(Notifications))
        return when (target) {
            "APP-HOME" -> {
                DeepLink.Screen(Tab.HOME, emptyList())
            }

            "APP-MATCHES" -> {
                DeepLink.Screen(Tab.HOME, listOf(Matches))
            }

            "APP-SEARCH" -> {
                DeepLink.Screen(Tab.SEARCH, listOf(Search(savedSearchId = param("saved_search_id"))))
            }

            "APP-PROFILE" -> {
                param("profile_id")?.let { DeepLink.Screen(Tab.HOME, listOf(Profile(it))) } ?: unknown
            }

            "APP-INTERESTS" -> {
                DeepLink.Screen(
                    Tab.INTERESTS,
                    listOf(Interests(box = param("box") ?: "received", interestId = param("interest_id"))),
                )
            }

            "APP-CHAT" -> {
                param("connection_id")?.let { DeepLink.Screen(Tab.CHATS, listOf(Chat(it))) } ?: unknown
            }

            "APP-CONNECTION" -> {
                param("connection_id")?.let { DeepLink.Screen(Tab.CHATS, listOf(Chat(it), ConnectionDetails(it))) }
                    ?: unknown
            }

            "APP-PHOTO-REQUESTS" -> {
                DeepLink.Screen(Tab.ME, listOf(PhotoRequests(box = param("box") ?: "received")))
            }

            "APP-VISITORS" -> {
                DeepLink.Screen(Tab.HOME, listOf(Visitors))
            }

            "APP-NOTIFS" -> {
                unknown
            }

            "ME-PROFILE" -> {
                DeepLink.Screen(Tab.ME, emptyList())
            }

            "ME-PHOTOS" -> {
                DeepLink.Screen(Tab.ME, listOf(MyPhotos))
            }

            "ME-EDIT" -> {
                when (val field = param("field")) {
                    "partner_notes" -> {
                        DeepLink.Screen(Tab.ME, listOf(MyPreferences))
                    }

                    else -> {
                        val section = param("section") ?: if (field == "about_family") "family" else "lifestyle"
                        DeepLink.Screen(Tab.ME, listOf(EditSection(section)))
                    }
                }
            }

            "ME-PREFS" -> {
                DeepLink.Screen(Tab.ME, listOf(MyPreferences))
            }

            "ME-VERIFY" -> {
                DeepLink.Screen(Tab.ME, listOf(Verification))
            }

            "GATE-CHANGES" -> {
                DeepLink.Screen(Tab.HOME, listOf(GateChanges))
            }

            "SET-ACCOUNT" -> {
                DeepLink.Screen(Tab.ME, listOf(Settings, AccountSettings))
            }

            "PUB-GUIDELINES" -> {
                DeepLink.WebPage("community-guidelines")
            }

            else -> {
                unknown
            }
        }
    }

    /** App Links of specs/22 section 3.4. Other URLs of the site open in the browser. */
    fun fromUri(uri: Uri): DeepLink? = fromPath(uri.path.orEmpty())

    /** The App Link for a URL path such as `/profiles/{id}`, or `null` when it is not one. */
    fun fromPath(path: String): DeepLink? {
        val segments = path.split('/').filter { it.isNotEmpty() }
        return when {
            segments.size == 2 && segments[0] == "profiles" -> DeepLink.Screen(Tab.HOME, listOf(Profile(segments[1])))

            segments.size == 2 && segments[0] == "p" -> DeepLink.ProfileCode(segments[1].uppercase())

            segments.size >= 2 && segments[0] == "chats" -> DeepLink.Screen(Tab.CHATS, listOf(Chat(segments[1])))

            segments.size == 1 && segments[0] == "interests" -> DeepLink.Screen(
                Tab.INTERESTS,
                listOf(Interests("received")),
            )

            else -> null
        }
    }
}
