package com.khandanirishta.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.PhotoView

/** Which variant of a photo to load (specs/16 rule G10). */
enum class PhotoSize { THUMB, MEDIUM, LARGE }

/** The URL without its query string: the signature changes hourly, the object path does not (08 section 5.4). */
fun stableKey(url: String): String = url.substringBefore('?')

/** An image request whose memory and disk cache keys ignore the URL signature. */
@Composable
fun rememberStableImageRequest(url: String?): ImageRequest? {
    val context = LocalContext.current
    return remember(url) {
        url?.let {
            ImageRequest
                .Builder(context)
                .data(it)
                .memoryCacheKey(stableKey(it))
                .diskCacheKey(stableKey(it))
                .crossfade(true)
                .build()
        }
    }
}

fun PhotoView.url(size: PhotoSize): String =
    when (size) {
        PhotoSize.THUMB -> thumbUrl
        PhotoSize.MEDIUM -> mediumUrl
        PhotoSize.LARGE -> largeUrl ?: mediumUrl
    }

/**
 * Another member's photo (specs/17 section 10 `MemberPhoto`): the variant for the size, the image
 * as received with a lock when it is blurred (never blurred or unblurred on the device), and a
 * neutral silhouette when there is no photo.
 */
@Composable
fun MemberPhoto(
    photo: PhotoView?,
    gender: Gender?,
    size: PhotoSize,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    shape: Shape? = null,
    showLock: Boolean = true,
    lockSize: Dp = 18.dp,
) {
    val clipped = if (shape != null) modifier.clip(shape) else modifier
    val request = rememberStableImageRequest(photo?.url(size))
    Box(
        modifier = clipped.semantics { this.contentDescription = contentDescription.orEmpty() },
        contentAlignment = Alignment.Center,
    ) {
        if (request == null) {
            PhotoPlaceholder(gender = gender, modifier = Modifier.fillMaxSize())
        } else {
            SubcomposeAsyncImage(
                model = request,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .shimmer(),
                    )
                },
                error = { PhotoPlaceholder(gender = gender, modifier = Modifier.fillMaxSize()) },
            )
            if (photo?.isBlurred == true && showLock) {
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.TopEnd)
                            .padding(8.dp)
                            .size(lockSize + 10.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Lock,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(lockSize - 2.dp),
                    )
                }
            }
        }
    }
}

/** The silhouette shown when a member has no photo, different for male and female profiles. */
@Composable
fun PhotoPlaceholder(
    gender: Gender?,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Image(
            painter =
                painterResource(
                    if (gender == Gender.FEMALE) R.drawable.ic_silhouette_female else R.drawable.ic_silhouette_male,
                ),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(0.78f),
        )
    }
}

/**
 * A small round avatar for rows and headers. A blurred photo gets a small lock badge on its edge
 * (rule G10): the lock of [MemberPhoto] would cover most of a photo this small.
 */
@Composable
fun Avatar(
    photo: PhotoView?,
    gender: Gender?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
) {
    Box(modifier.size(size)) {
        MemberPhoto(
            photo = photo,
            gender = gender,
            size = PhotoSize.THUMB,
            contentDescription = contentDescription,
            modifier = Modifier.fillMaxSize(),
            shape = CircleShape,
            showLock = false,
        )
        if (photo?.isBlurred == true) {
            val badge = (size * LOCK_BADGE_SHARE).coerceIn(14.dp, 22.dp)
            Box(
                modifier =
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(badge)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(1.5.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.6f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(badge * LOCK_ICON_SHARE),
                )
            }
        }
    }
}

private const val LOCK_BADGE_SHARE = 0.36f
private const val LOCK_ICON_SHARE = 0.6f
