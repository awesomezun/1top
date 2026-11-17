import UIKit

/// A photo picked for a message: a JPEG that fits the relay's limit, and a preview for the screen.
struct PickedPhoto: Identifiable {
    let id = UUID()
    var jpeg: Data
    var preview: UIImage
}

/// What is being written to one session. It stays with the session until it is sent, so switching
/// sessions, a failed send or a session without photo support never throws it away.
struct Draft {
    var text = ""
    var photos: [PickedPhoto] = []
    var error: String?
    var isEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && photos.isEmpty }

    /// This draft with `other` brought back after it: text on a new line, photos up to the limit.
    func appending(_ other: Draft) -> Draft {
        var out = self
        let mine = text.trimmingCharacters(in: .whitespacesAndNewlines), theirs = other.text.trimmingCharacters(in: .whitespacesAndNewlines)
        out.text = mine.isEmpty ? other.text : theirs.isEmpty ? text : text + "\n" + other.text
        out.photos = Array((photos + other.photos).prefix(PhotoPrep.maxPhotos))
        out.error = nil
        return out
    }
}

/// Fits a photo to the conversation contract: at most 1600 pixels on the long edge, re-encoded as
/// JPEG so camera metadata (EXIF, location) is not sent, and at most 524,288 bytes. Quality drops
/// first, then size; a photo that still does not fit is refused with the reason.
enum PhotoPrep {
    static let maxBytes = 524_288
    static let maxEdge: CGFloat = 1600
    static let maxPhotos = 3

    static func prepare(_ data: Data) throws -> PickedPhoto {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else {
            throw Relay.Failure(status: nil, message: L.t("This photo could not be read.", "이 사진을 읽을 수 없습니다."))
        }
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        // First at its own size (capped at 1600) whatever that size is, so small images pass; the
        // 480-pixel floor applies only to the shrinking that follows.
        var edge = min(maxEdge, max(pixels.width, pixels.height))
        while true {
            let resized = render(image, pixels: pixels, longEdge: edge)
            for quality in [0.82, 0.7, 0.58, 0.46, 0.36] as [CGFloat] {
                if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= maxBytes {
                    return PickedPhoto(jpeg: jpeg, preview: resized)
                }
            }
            let next = edge * 0.75
            guard next >= 480 else { break }
            edge = next
        }
        throw Relay.Failure(status: nil, message: L.t("This photo could not be made small enough (512 KB) and was left out.",
                                                      "이 사진은 512KB 이하로 줄일 수 없어 제외했습니다."))
    }

    /// Redraws the photo upright at the new size; the drawing carries no metadata from the original.
    private static func render(_ image: UIImage, pixels: CGSize, longEdge: CGFloat) -> UIImage {
        let scale = min(1, longEdge / max(pixels.width, pixels.height))
        let size = CGSize(width: max(1, (pixels.width * scale).rounded()), height: max(1, (pixels.height * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        // JPEG has no transparency: a transparent PNG goes on white rather than black.
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// The demo's pictures: the conversation script's checkout screen (demo-world.js), then drawn ones.
    /// Release builds keep it, since the demo runs there too (App Review, first use); only the way UI tests
    /// put them in the composer instead of the system photo picker (`-qaDemoImages N`) is Debug-only.
    static func demo(_ count: Int) -> [PickedPhoto] {
        (0..<min(count, maxPhotos)).compactMap { i in
            if i == 0, let checkout = UIImage(named: "DemoCheckout")?.jpegData(compressionQuality: 0.9) { return try? prepare(checkout) }
            let size = CGSize(width: 1200, height: 900)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
                let colors: [UIColor] = [.systemTeal, .systemOrange, .systemIndigo]
                colors[i % colors.count].setFill()
                ctx.fill(CGRect(origin: .zero, size: size))
                let text = "\(i + 1)" as NSString
                text.draw(at: CGPoint(x: 80, y: 120), withAttributes: [.font: UIFont.systemFont(ofSize: 420, weight: .bold), .foregroundColor: UIColor.white])
            }
            return image.jpegData(compressionQuality: 0.9).flatMap { try? prepare($0) }
        }
    }
}
