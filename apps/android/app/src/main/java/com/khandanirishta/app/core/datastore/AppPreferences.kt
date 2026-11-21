package com.khandanirishta.app.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "app_preferences")

/**
 * The few device settings the app keeps (specs/22 section 6): nothing from the member APIs, only
 * flags about this device. Excluded from backups by the backup rules.
 */
@Singleton
class AppPreferences
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
    ) {
        private val store get() = context.dataStore

        val locale: Flow<String?> = store.data.map { it[LOCALE] }

        suspend fun setLocale(value: String) = store.edit { it[LOCALE] = value }

        suspend fun lastUpdatePromptAt(): Long = store.data.first()[LAST_UPDATE_PROMPT_AT] ?: 0L

        suspend fun setLastUpdatePromptAt(value: Long) = store.edit { it[LAST_UPDATE_PROMPT_AT] = value }

        suspend fun notificationPermissionAsked(): Boolean = store.data.first()[NOTIFICATION_PERMISSION_ASKED] ?: false

        suspend fun setNotificationPermissionAsked() = store.edit { it[NOTIFICATION_PERMISSION_ASKED] = true }

        suspend fun pushToken(): String? = store.data.first()[PUSH_TOKEN]

        suspend fun setPushToken(value: String?) =
            store.edit {
                if (value == null) it.remove(PUSH_TOKEN) else it[PUSH_TOKEN] = value
            }

        /** One-time tips and dismissed banners, stored as keys on this device (specs/16 sections 6.4 and 6.11). */
        val dismissed: Flow<Set<String>> = store.data.map { it[DISMISSED].orEmpty() }

        suspend fun dismiss(key: String) = store.edit { it[DISMISSED] = it[DISMISSED].orEmpty() + key }

        /** Clears what belongs to the signed-in member; the push token and locale stay with the device. */
        suspend fun clearMemberFlags() = store.edit { it.remove(DISMISSED) }

        private companion object {
            val LOCALE = stringPreferencesKey("locale")
            val LAST_UPDATE_PROMPT_AT = longPreferencesKey("last_update_prompt_at")
            val NOTIFICATION_PERMISSION_ASKED = booleanPreferencesKey("notification_permission_asked")
            val PUSH_TOKEN = stringPreferencesKey("push_token")
            val DISMISSED = stringSetPreferencesKey("dismissed")
        }
    }
