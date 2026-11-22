package com.khandanirishta.app.ui.preview

import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.Badge
import com.khandanirishta.app.core.network.generated.model.CardRelation
import com.khandanirishta.app.core.network.generated.model.ChildrenStatus
import com.khandanirishta.app.core.network.generated.model.Compatibility
import com.khandanirishta.app.core.network.generated.model.CompatibilityDimension
import com.khandanirishta.app.core.network.generated.model.Counters
import com.khandanirishta.app.core.network.generated.model.DetailBasics
import com.khandanirishta.app.core.network.generated.model.DetailCommunity
import com.khandanirishta.app.core.network.generated.model.DetailEducationCareer
import com.khandanirishta.app.core.network.generated.model.DetailFamily
import com.khandanirishta.app.core.network.generated.model.DetailLifestyle
import com.khandanirishta.app.core.network.generated.model.DetailLocation
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.InterestDirection
import com.khandanirishta.app.core.network.generated.model.InterestStatus
import com.khandanirishta.app.core.network.generated.model.LegalVersions
import com.khandanirishta.app.core.network.generated.model.LockedGroup
import com.khandanirishta.app.core.network.generated.model.LookingFor
import com.khandanirishta.app.core.network.generated.model.LookingForLine
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.core.network.generated.model.MeConfig
import com.khandanirishta.app.core.network.generated.model.MeProfile
import com.khandanirishta.app.core.network.generated.model.MeUsage
import com.khandanirishta.app.core.network.generated.model.MeUser
import com.khandanirishta.app.core.network.generated.model.NamedItem
import com.khandanirishta.app.core.network.generated.model.OnboardingStep
import com.khandanirishta.app.core.network.generated.model.OptionItem
import com.khandanirishta.app.core.network.generated.model.PhotoView
import com.khandanirishta.app.core.network.generated.model.ProfileCard
import com.khandanirishta.app.core.network.generated.model.ProfileDetail
import com.khandanirishta.app.core.network.generated.model.ProfileStatus
import com.khandanirishta.app.core.network.generated.model.ReferenceBootstrap
import com.khandanirishta.app.core.network.generated.model.Relation
import com.khandanirishta.app.core.network.generated.model.RelationInterest
import com.khandanirishta.app.core.network.generated.model.RelationPhotoAccess
import com.khandanirishta.app.core.network.generated.model.Tier
import com.khandanirishta.app.core.network.generated.model.UserRole
import com.khandanirishta.app.core.network.generated.model.UserStatus
import java.time.Duration
import java.time.Instant
import com.khandanirishta.app.core.network.generated.model.Locale as ApiLocale

/**
 * Invented members for previews and instrumented tests, in the debug build only. The names are
 * long on purpose: DESIGN.md section 7 says they wrap.
 */
object SampleData {
    const val LONG_NAME = "Muhammad Abdul Rehman Siddiqui S."

    val reference =
        Reference(
            ReferenceBootstrap(
                castes = emptyList(),
                countries = emptyList(),
                educationFields = emptyList(),
                educationLevels = emptyList(),
                hobbies = emptyList(),
                incomeBands = emptyList(),
                languages = listOf(NamedItem(code = "urdu", name = "Urdu")),
                options =
                    mapOf(
                        Lists.MARITAL_STATUS to
                            listOf(
                                OptionItem(code = MaritalStatus.NEVER_MARRIED.wire, label = "Never married"),
                                OptionItem(code = MaritalStatus.DIVORCED.wire, label = "Divorced"),
                            ),
                        Lists.MANAGED_BY to listOf(OptionItem(code = ManagedBy.PARENT.wire, label = "Parent")),
                        Lists.EMPLOYMENT_TYPE to
                            listOf(OptionItem(code = EmploymentType.PRIVATE_JOB.wire, label = "Private job")),
                    ),
                professionCategories = listOf(NamedItem(code = "software", name = "Software and IT")),
                religions = emptyList(),
                version = "sample",
            ),
        )

    /** An address that never resolves, so a photo is shown in its loading or failed state. */
    fun photo(
        id: String = "photo-1",
        blurred: Boolean = false,
    ): PhotoView =
        PhotoView(
            id = id,
            isBlurred = blurred,
            isPrimary = id == "photo-1",
            largeUrl = null,
            mediumUrl = "https://photos.invalid/$id/medium.jpg",
            thumbUrl = "https://photos.invalid/$id/thumb.jpg",
        )

    fun card(
        id: String = "member-1",
        name: String = "Ayesha K.",
        photo: PhotoView? = null,
        photoCount: Long = if (photo == null) 0 else 3,
        badges: List<Badge> = listOf(Badge.ID_VERIFIED, Badge.PHOTO_VERIFIED),
        tier: Tier = Tier.MEMBER,
        direction: InterestDirection? = null,
        shortlisted: Boolean = false,
        managedBy: ManagedBy = ManagedBy.SELF,
        maritalStatus: MaritalStatus = MaritalStatus.NEVER_MARRIED,
        reasons: List<String> = listOf("same_city", "religiosity_fits", "education_fits"),
        compat: Int? = 87,
    ): ProfileCard =
        ProfileCard(
            age = 26,
            badges = badges,
            casteLabel = "Rajput",
            cityName = "Lahore",
            compat = compat,
            countryCode = "PK",
            displayName = name,
            educationLevelCode = "masters",
            employmentType = EmploymentType.PRIVATE_JOB,
            gender = Gender.FEMALE,
            heightCm = 163,
            id = id,
            lastActive = null,
            managedBy = managedBy,
            maritalStatus = maritalStatus,
            motherTongueCode = "urdu",
            photo = photo,
            photoCount = photoCount,
            professionCode = "software",
            publicCode = "KR7F3K2QX9",
            reasons = reasons,
            regionName = "Punjab",
            relation =
                CardRelation(
                    canSendInterest = tier == Tier.MEMBER,
                    connectionId = if (tier == Tier.CONNECTION) "connection-1" else null,
                    interestDirection = direction,
                    interestStatus = direction?.let { InterestStatus.PENDING },
                    isShortlisted = shortlisted,
                    tier = tier,
                ),
            religionCode = "islam",
            sectCode = null,
        )

    fun detail(
        card: ProfileCard = card(),
        tier: Tier = Tier.MEMBER,
        photos: List<PhotoView> = emptyList(),
        locked: List<LockedGroup> = emptyList(),
        access: RelationPhotoAccess = RelationPhotoAccess.VISIBLE,
    ): ProfileDetail =
        ProfileDetail(
            aboutFamily = "We are a close family from Lahore.",
            aboutMe = "I enjoy reading, and I care a great deal about family.",
            basics =
                DetailBasics(
                    childrenStatus = ChildrenStatus.NONE,
                    heightCm = 163,
                    maritalStatus = card.maritalStatus,
                ),
            card = card,
            community =
                DetailCommunity(
                    casteLabel = "Rajput",
                    languageCodes = emptyList(),
                    motherTongueCode = "urdu",
                    religionCode = "islam",
                ),
            compatibility =
                Compatibility(
                    compat = 87,
                    dimensions =
                        listOf(
                            CompatibilityDimension("religiosity", Importance.MUST, matched = true, score = 1.0),
                            CompatibilityDimension("location", Importance.MEDIUM, matched = false, score = 0.0),
                        ),
                    ownerFit = 81,
                    reasons = card.reasons,
                    viewerFit = 92,
                ),
            educationCareer =
                DetailEducationCareer(
                    educationLevelCode = "masters",
                    employmentType = EmploymentType.PRIVATE_JOB,
                    professionCode = "software",
                ),
            family = DetailFamily(brothersCount = 2, brothersMarried = 1, sistersCount = 1, sistersMarried = 0),
            isOnline = true,
            lifestyle = DetailLifestyle(hobbyCodes = listOf("reading", "cooking")),
            location = DetailLocation(cityName = "Lahore", countryCode = "PK", regionName = "Punjab"),
            locked = locked,
            lookingFor =
                LookingFor(
                    lines =
                        listOf(
                            LookingForLine("age", Importance.MUST, listOf("25", "32"), viewerMatches = true),
                            LookingForLine("height", Importance.MEDIUM, listOf("170", ""), viewerMatches = false),
                        ),
                    matched = 1,
                    total = 2,
                ),
            partnerNotes = null,
            photos = photos,
            relation = relation(tier, access),
        )

    fun relation(
        tier: Tier,
        access: RelationPhotoAccess = RelationPhotoAccess.VISIBLE,
    ): Relation {
        val now = Instant.now()
        val direction =
            when (tier) {
                Tier.INTEREST_FROM_OWNER -> InterestDirection.RECEIVED
                Tier.INTEREST_TO_OWNER -> InterestDirection.SENT
                else -> null
            }
        return Relation(
            canSendInterest = tier == Tier.MEMBER,
            connectionId = if (tier == Tier.CONNECTION) "connection-1" else null,
            interest =
                direction?.let {
                    RelationInterest(
                        createdAt = now,
                        direction = it,
                        expiresAt = now.plus(Duration.ofDays(2)),
                        id = "interest-1",
                        message = "Assalam-o-Alaikum. Our preferences seem to match well.",
                        status = InterestStatus.PENDING,
                    )
                },
            isPassed = false,
            isShortlisted = false,
            photoAccess = access,
            tier = tier,
        )
    }

    fun me(
        managedBy: ManagedBy = ManagedBy.SELF,
        gender: Gender = Gender.MALE,
        pendingInterests: Long = 2,
    ): Me =
        Me(
            config =
                MeConfig(
                    deletionGraceDays = 30,
                    identityRequired = false,
                    legal = LegalVersions(guidelinesVersion = "1", privacyVersion = "1", termsVersion = "1"),
                    photoRequired = false,
                    photosMax = 6,
                    supportEmail = "support@example.invalid",
                ),
            consentsRequired = emptyList(),
            counters =
                Counters(
                    pendingInterests = pendingInterests,
                    pendingPhotoRequests = 0,
                    unreadChats = 3,
                    unreadNotifications = 4,
                ),
            gate = Gate.OK,
            profile =
                MeProfile(
                    badges = emptyList(),
                    completeness = 64,
                    firstName = "Bilal",
                    gender = gender,
                    id = "viewer-1",
                    managedBy = managedBy,
                    onboardingStep = OnboardingStep.DONE,
                    publicCode = "KR2B4C6D8E",
                    status = ProfileStatus.ACTIVE,
                ),
            usage = MeUsage(interestsPerDay = 5, interestsSentToday = 1),
            user =
                MeUser(
                    createdAt = Instant.EPOCH,
                    emailVerified = false,
                    id = "user-1",
                    locale = ApiLocale.EN,
                    phoneVerified = true,
                    role = UserRole.MEMBER,
                    status = UserStatus.ACTIVE,
                    timezone = "Asia/Karachi",
                ),
        )
}
