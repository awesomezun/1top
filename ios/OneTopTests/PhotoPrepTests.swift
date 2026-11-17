import ImageIO
import UIKit
import UniformTypeIdentifiers
import XCTest
@testable import OneTop

/// Photos are fitted to the conversation contract: any readable image, small ones included, comes
/// out as JPEG within 1600 pixels and 524,288 bytes, without camera metadata.
final class PhotoPrepTests: XCTestCase {
    private func drawn(_ size: CGSize, opaque: Bool = true) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(opaque ? CGRect(origin: .zero, size: size) : CGRect(x: 0, y: 0, width: max(1, size.width / 2), height: max(1, size.height / 2)))
        }
    }

    private func properties(_ data: Data) -> [CFString: Any] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return [:] }
        return props
    }

    private func pixels(_ data: Data) -> CGSize {
        let props = properties(data)
        return CGSize(width: props[kCGImagePropertyPixelWidth] as? Int ?? 0, height: props[kCGImagePropertyPixelHeight] as? Int ?? 0)
    }

    private func isJPEG(_ data: Data) -> Bool { data.starts(with: [0xFF, 0xD8]) }

    func testSmallJPEGIsAccepted() throws {
        let photo = try PhotoPrep.prepare(XCTUnwrap(drawn(CGSize(width: 320, height: 200)).jpegData(compressionQuality: 0.9)))
        XCTAssertTrue(isJPEG(photo.jpeg))
        XCTAssertLessThanOrEqual(photo.jpeg.count, PhotoPrep.maxBytes)
        XCTAssertEqual(pixels(photo.jpeg), CGSize(width: 320, height: 200))
    }

    func testOnePixelPNGIsAccepted() throws {
        let photo = try PhotoPrep.prepare(XCTUnwrap(drawn(CGSize(width: 1, height: 1)).pngData()))
        XCTAssertTrue(isJPEG(photo.jpeg))
        XCTAssertEqual(pixels(photo.jpeg), CGSize(width: 1, height: 1))
    }

    func testTransparentPNGIsAccepted() throws {
        let photo = try PhotoPrep.prepare(XCTUnwrap(drawn(CGSize(width: 300, height: 300), opaque: false).pngData()))
        XCTAssertTrue(isJPEG(photo.jpeg))
        XCTAssertLessThanOrEqual(photo.jpeg.count, PhotoPrep.maxBytes)
        XCTAssertEqual(pixels(photo.jpeg), CGSize(width: 300, height: 300))
    }

    func testLargePhotoIsResizedAndFits() throws {
        let size = CGSize(width: 4032, height: 3024)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        // Busy content so the JPEG is large, as a real photo would be.
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            var generator = SystemRandomNumberGenerator()
            for _ in 0..<4000 {
                UIColor(hue: .random(in: 0...1, using: &generator), saturation: 0.8, brightness: .random(in: 0.3...1, using: &generator), alpha: 1).setFill()
                ctx.fill(CGRect(x: .random(in: 0..<size.width, using: &generator), y: .random(in: 0..<size.height, using: &generator), width: 60, height: 60))
            }
        }
        let photo = try PhotoPrep.prepare(XCTUnwrap(image.jpegData(compressionQuality: 1)))
        let out = pixels(photo.jpeg)
        XCTAssertLessThanOrEqual(max(out.width, out.height), 1600)
        XCTAssertLessThanOrEqual(photo.jpeg.count, PhotoPrep.maxBytes)
    }

    func testCameraMetadataIsRemoved() throws {
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
        let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: 37.5, kCGImagePropertyGPSLatitudeRef: "N",
                                    kCGImagePropertyGPSLongitude: 127.0, kCGImagePropertyGPSLongitudeRef: "E"]
        let exif: [CFString: Any] = [kCGImagePropertyExifUserComment: "private note"]
        CGImageDestinationAddImage(destination, try XCTUnwrap(drawn(CGSize(width: 640, height: 480)).cgImage),
                                   [kCGImagePropertyGPSDictionary: gps, kCGImagePropertyExifDictionary: exif] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        XCTAssertNotNil(properties(data as Data)[kCGImagePropertyGPSDictionary], "The test photo should carry GPS")
        let photo = try PhotoPrep.prepare(data as Data)
        let out = properties(photo.jpeg)
        XCTAssertNil(out[kCGImagePropertyGPSDictionary])
        XCTAssertNil((out[kCGImagePropertyExifDictionary] as? [CFString: Any])?[kCGImagePropertyExifUserComment])
    }

    func testUnreadableDataIsRefused() {
        XCTAssertThrowsError(try PhotoPrep.prepare(Data([1, 2, 3])))
    }
}
